#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "MAX30105.h"
#include "heartRate.h"

// NeuroBloom NeuroBand — BLE GATT + MAX30102/MAX3010x.
// Não é equipamento médico e não deve orientar decisões clínicas.
// I2C padrão do ESP32 clássico: SDA 21 / SCL 22. Ajuste se sua placa usar outros pinos.
#define I2C_SDA 21
#define I2C_SCL 22

char deviceName[24] = "NeuroBand";
static const char* SERVICE_UUID = "7b6e1000-8d4a-4a7f-9b31-0b6e2a1c1000";
static const char* DATA_UUID = "7b6e1001-8d4a-4a7f-9b31-0b6e2a1c1000";

MAX30105 sensor;
BLEServer* bleServer = nullptr;
BLECharacteristic* dataCharacteristic = nullptr;
BLE2902* notificationDescriptor = nullptr;
volatile bool clientConnected = false;
volatile bool restartAdvertising = false;
volatile uint32_t disconnectedAtMs = 0;
bool sensorReady = false;

const uint32_t SAMPLE_INTERVAL_MS = 1000;
const uint32_t READING_TIMEOUT_MS = 4000;
const uint32_t SENSOR_RETRY_MS = 5000;
const long MIN_CONTACT_IR = 10000; // Heurística; ajustar após validar o módulo físico.
const int MIN_BPM = 25;
const int MAX_BPM = 250;

uint32_t lastSampleMs = 0;
uint32_t lastSensorRetryMs = 0;
uint32_t lastBeatMs = 0;
uint32_t lastValidBeatMs = 0;
uint16_t recentBeats[4] = {0};
uint8_t beatCount = 0;
uint8_t beatPosition = 0;
uint16_t beatAvg = 0;

void clearReading() {
  const bool hadReading = lastBeatMs != 0 || beatAvg != 0;
  lastBeatMs = 0;
  lastValidBeatMs = 0;
  beatCount = 0;
  beatPosition = 0;
  beatAvg = 0;
  // READ também não pode devolver o último BPM após perder contato.
  // Zero significa "aguardando leitura"; nunca é uma medição a persistir.
  if (hadReading && dataCharacteristic) {
    uint8_t waiting[3] = {0, 0, 0};
    dataCharacteristic->setValue(waiting, sizeof(waiting));
  }
}

bool startSensor() {
  if (!sensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("Sensor ausente: confira alimentacao e I2C. BLE continua disponivel.");
    return false;
  }
  // Duas LEDs (vermelho + IR), compatível com MAX30102 e MAX30105.
  sensor.setup(0x1F, 4, 2, 400, 411, 4096);
  sensor.setPulseAmplitudeGreen(0);
  clearReading();
  Serial.println("Sensor encontrado. Aguardando contato e batimentos validos.");
  return true;
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    clientConnected = true;
    restartAdvertising = false;
    Serial.println("BLE: cliente conectado.");
  }
  void onDisconnect(BLEServer*) override {
    clientConnected = false;
    disconnectedAtMs = millis();
    restartAdvertising = true;
    Serial.println("BLE: cliente desconectado.");
  }
};

void setup() {
  Serial.begin(115200);
  Wire.begin(I2C_SDA, I2C_SCL);

  // Sufixo estável para distinguir pulseiras próximas, sem anunciar o MAC inteiro.
  snprintf(deviceName, sizeof(deviceName), "NeuroBand-%04X", (uint16_t)(ESP.getEfuseMac() >> 32));
  BLEDevice::init(deviceName);
  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new ServerCallbacks());
  BLEService* service = bleServer->createService(SERVICE_UUID);
  dataCharacteristic = service->createCharacteristic(
    DATA_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  notificationDescriptor = new BLE2902();
  dataCharacteristic->addDescriptor(notificationDescriptor);
  uint8_t waiting[3] = {0, 0, 0};
  dataCharacteristic->setValue(waiting, sizeof(waiting));
  service->start();
  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.println("NeuroBand pronto. Aguardando BLE e sensor...");
  Serial.printf("BLE name=%s\n", deviceName);
  Serial.printf("BLE service=%s\n", SERVICE_UUID);
  Serial.printf("BLE data=%s\n", DATA_UUID);
  sensorReady = startSensor();
  lastSensorRetryMs = millis();
}
void loop() {
  uint32_t now = millis();
  // Aguarda a pilha BLE fora do callback; desconectar não bloqueia a amostragem.
  if (restartAdvertising && !clientConnected && now - disconnectedAtMs >= 500) {
    restartAdvertising = false;
    bleServer->startAdvertising();
    Serial.println("BLE: anunciando novamente.");
  }

  if (!sensorReady) {
    if (now - lastSensorRetryMs >= SENSOR_RETRY_MS) {
      lastSensorRetryMs = now;
      sensorReady = startSensor();
    }
    delay(10);
    return;
  }

  long irValue = sensor.getIR();
  now = millis();
  if (irValue < MIN_CONTACT_IR) {
    clearReading();
  } else {
    if (lastValidBeatMs && now - lastValidBeatMs > READING_TIMEOUT_MS) {
      clearReading();
    }
    if (checkForBeat(irValue)) {
      const uint32_t intervalMs = now - lastBeatMs;
      if (lastBeatMs && intervalMs > 0) {
        const float bpm = 60000.0f / intervalMs;
        if (bpm >= MIN_BPM && bpm <= MAX_BPM) {
          recentBeats[beatPosition] = (uint16_t)(bpm + 0.5f);
          beatPosition = (beatPosition + 1) % 4;
          if (beatCount < 4) beatCount++;
          uint32_t total = 0;
          for (uint8_t i = 0; i < beatCount; i++) total += recentBeats[i];
          beatAvg = total / beatCount;
          lastValidBeatMs = now;
        }
      }
      lastBeatMs = now;
    }
  }

  if (now - lastSampleMs >= SAMPLE_INTERVAL_MS) {
    lastSampleMs = now;
    if (!beatAvg || !lastValidBeatMs || now - lastValidBeatMs > READING_TIMEOUT_MS) {
      Serial.printf("Aguardando batimento valido... IR=%ld\n", irValue);
      delay(10);
      return;
    }
    // Índice de contato óptico, não percentual de precisão clínica.
    uint8_t quality = irValue > 50000 ? 90 : 60;
    uint8_t packet[3];
    packet[0] = beatAvg & 0xFF;
    packet[1] = (beatAvg >> 8) & 0xFF;
    packet[2] = quality;
    Serial.printf("BPM=%u Q=%u IR=%ld\n", beatAvg, quality, irValue);
    dataCharacteristic->setValue(packet, sizeof(packet));
    if (clientConnected && notificationDescriptor->getNotifications()) {
      dataCharacteristic->notify();
    }
  }
  delay(10);
}
