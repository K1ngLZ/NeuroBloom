#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "MAX30105.h"
#include "heartRate.h"

// NeuroBloom NeuroBand — firmware de bancada.
// PROTÓTIPO: não é equipamento médico e não deve orientar decisões clínicas.
// I2C padrão do ESP32 clássico: SDA 21 / SCL 22. Ajuste se sua placa usar outros pinos.
#define I2C_SDA 21
#define I2C_SCL 22

static const char* DEVICE_NAME = "NeuroBand";
static const char* SERVICE_UUID = "7b6e1000-8d4a-4a7f-9b31-0b6e2a1c1000";
static const char* DATA_UUID = "7b6e1001-8d4a-4a7f-9b31-0b6e2a1c1000";

MAX30105 sensor;
BLECharacteristic* dataCharacteristic = nullptr;
bool clientConnected = false;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    clientConnected = true;
    Serial.println("BLE: cliente conectado.");
  }
  void onDisconnect(BLEServer* server) override {
    clientConnected = false;
    Serial.println("BLE: cliente desconectado; anunciando novamente.");
    delay(100);
    server->startAdvertising();
  }
};

uint32_t lastSampleMs = 0;
int beatAvg = 0;
void setup() {
  Serial.begin(115200);
  Wire.begin(I2C_SDA, I2C_SCL);

  if (!sensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("ERRO: MAX30102/MAX3010x nao encontrado.");
    while (true) delay(1000);
  }

  sensor.setup();
  sensor.setPulseAmplitudeRed(0x1F);
  sensor.setPulseAmplitudeIR(0x1F);
  sensor.setPulseAmplitudeGreen(0);

  BLEDevice::init(DEVICE_NAME);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  BLEService* service = server->createService(SERVICE_UUID);
  dataCharacteristic = service->createCharacteristic(
    DATA_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  dataCharacteristic->addDescriptor(new BLE2902());
  dataCharacteristic->setValue("{\"status\":\"ready\"}");
  service->start();
  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.println("NeuroBand pronto. Aguardando BLE e sensor...");
  Serial.printf("BLE service=%s\n", SERVICE_UUID);
  Serial.printf("BLE data=%s\n", DATA_UUID);
}
void loop() {
  long irValue = sensor.getIR();
  if (checkForBeat(irValue)) {
    static uint32_t lastBeat = 0;
    uint32_t now = millis();
    if (lastBeat > 0) {
      float bpm = 60.0f / ((now - lastBeat) / 1000.0f);
      if (bpm > 20 && bpm < 255) {
        beatAvg = (beatAvg * 3 + (int)bpm) / 4;
      }
    }
    lastBeat = now;
  }

  if (millis() - lastSampleMs >= 1000) {
    lastSampleMs = millis();
    int quality = irValue > 50000 ? 90 : (irValue > 10000 ? 60 : 20);
    int bpm = beatAvg > 0 ? beatAvg : 0;
    if (bpm == 0) {
      Serial.printf("Aguardando batimento valido... Q=%d IR=%ld\n", quality, irValue);
      delay(10);
      return;
    }
    uint8_t packet[3];
    packet[0] = bpm & 0xFF;
    packet[1] = (bpm >> 8) & 0xFF;
    packet[2] = quality;
    Serial.printf("BPM=%d Q=%d IR=%ld\n", bpm, quality, irValue);
    if (clientConnected && dataCharacteristic) {
      dataCharacteristic->setValue(packet, sizeof(packet));
      dataCharacteristic->notify();
    }
  }
  delay(10);
}
