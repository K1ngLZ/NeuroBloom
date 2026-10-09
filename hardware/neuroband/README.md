# NeuroBand — firmware BLE

O ESP32 anuncia a NeuroBand por Bluetooth Low Energy. O navegador próximo recebe as notificações e as encaminha à API online do NeuroBloom pela sessão do responsável. O servidor da Railway não acessa o rádio Bluetooth diretamente: durante a coleta, mantenha o site aberto no aparelho conectado à pulseira.

## Placa e sensor

Este firmware foi compilado para **ESP32 Dev Module clássico**, usando Arduino-ESP32 **3.3.12** e **SparkFun MAX3010x Pulse and Proximity Sensor Library 1.1.2**. O sensor é configurado para vermelho + infravermelho, compatível com MAX30102/MAX30105. ESP32-S2 não tem Bluetooth; outras variantes exigem selecionar a placa correta e conferir a pinagem.

| Módulo MAX3010x | ESP32 clássico |
| --- | --- |
| SDA | GPIO 21 |
| SCL | GPIO 22 |
| GND | GND |
| VIN/VCC | Alimentação permitida pelo seu breakout; use 3V3 somente se o módulo aceitar |
| INT | Não utilizado neste firmware |

Confira a tensão e os resistores de pull-up do seu módulo antes de ligar. Os sinais I2C do ESP32 devem usar lógica de 3,3 V. Os pinos podem ser alterados em `I2C_SDA` e `I2C_SCL`.

## Contrato GATT

- Nome anunciado: `NeuroBand-XXXX`, com sufixo estável para distinguir unidades próximas.
- Serviço: `7b6e1000-8d4a-4a7f-9b31-0b6e2a1c1000`.
- Característica de dados: `7b6e1001-8d4a-4a7f-9b31-0b6e2a1c1000`.
- Propriedades: `READ` e `NOTIFY`, com descritor CCCD `0x2902`.
- Valor: **exatamente 3 bytes**. Bytes 0–1: BPM `uint16` little-endian; byte 2: índice de contato óptico `uint8`, de 0 a 100.
- Exemplo: `[0x48, 0x00, 0x5A]` representa 72 BPM e contato 90.
- `[0, 0, 0]` significa **aguardando leitura** e pode aparecer em `READ`. Não é uma medição e não deve ser enviada ao backend. O firmware não notifica esse valor.

Uma leitura válida é atualizada a cada segundo e notificada somente depois da assinatura de notificações. O código aceita intervalos equivalentes a 25–250 BPM para corresponder ao contrato da API e calcula a média dos últimos quatro intervalos válidos, sem preencher a média com zeros iniciais. Isso é filtragem técnica, não classificação de saúde.

Ao perder contato óptico ou ficar quatro segundos sem intervalo de batimento válido, o firmware apaga o BPM da característica e para de notificá-lo. O limiar de contato `MIN_CONTACT_IR=10000` e os índices 60/90 são heurísticas que precisam ser ajustadas com o hardware real; não representam precisão clínica nem detectam estresse.

O anúncio BLE começa mesmo se o sensor estiver ausente. Nessa condição, é possível parear, mas não haverá leituras; o ESP32 procura o sensor novamente a cada cinco segundos. Após uma desconexão, volta a anunciar em cerca de 500 ms, sem bloquear o callback BLE.

## Compilar e carregar

1. No Arduino IDE, instale o pacote de placas **esp32 by Espressif Systems** e a biblioteca SparkFun indicada acima.
2. Abra `neuroband.ino`, escolha o modelo real da placa e conecte um cabo USB de dados.
3. Confirme qual porta aparece ao conectar e desaparece ao remover o ESP32. Uma porta `COM1` desconhecida não identifica a placa.
4. Compile e carregue somente depois de confirmar placa, porta e circuito. Abra o monitor serial a **115200 baud** para conferir o nome BLE e o sensor.

Para compilar pelo Arduino CLI, sem carregar a placa:

```powershell
arduino-cli compile --fqbn esp32:esp32:esp32 --output-dir .cache/neuroband-firmware hardware/neuroband
```

A saída inclui `neuroband.ino.bin` no diretório indicado. Compilar confirma compatibilidade do código com o alvo selecionado; a conexão física e o sinal óptico precisam ser conferidos com a pulseira montada.

## Conectar ao site

1. Use o site HTTPS em um navegador com Web Bluetooth, Bluetooth ligado e permissão do sistema para o navegador.
2. Entre no painel da família, selecione a criança correta e escolha **Conectar NeuroBand**.
3. Na janela nativa do navegador, escolha o nome `NeuroBand-XXXX` correspondente ao monitor serial da sua placa.
4. Confira o estado da conexão e aguarde uma leitura válida. Retire o contato e confirme que leituras antigas param; desconecte e conecte novamente para conferir o novo anúncio.

O nome BLE e o identificador fornecido pelo navegador não autenticam criptograficamente o hardware. Este firmware permite leitura BLE local e não implementa pareamento cifrado, identidade assinada, atualização remota nem conexão Wi-Fi direta. A autenticação da família e a autorização de persistência são tratadas pela API do site.

A NeuroBand não é um dispositivo médico validado. Antes de uso corporal, a montagem, alimentação, isolamento, bateria, ajuste e sinal do sensor precisam de validação própria. As leituras não devem orientar decisões clínicas.

Referências: [BLE no Arduino-ESP32](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/ble.html), [I2C no Arduino-ESP32](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/i2c.html) e [exemplo de batimentos da SparkFun](https://github.com/sparkfun/SparkFun_MAX3010x_Sensor_Library/blob/master/examples/Example5_HeartRate/Example5_HeartRate.ino).
