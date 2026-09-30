# NeuroBloom — guia de teste local

## 1. Abrir o site (Windows)

1. Abra o Explorador e entre em `Downloads\NeuroBloom`.
2. Clique na barra de endereço, digite `powershell` e pressione Enter.
3. Execute:
   ```powershell
   py -m http.server 5500
   ```
   Se o comando `py` não existir, tente `python -m http.server 5500`.
4. No Chrome ou Edge, abra http://localhost:5500
5. Para encerrar o servidor, volte ao PowerShell e pressione Ctrl+C.

O servidor estático permite testar layout e configurações. Não publique essa pasta na internet como produto final.

## 2. O que dá para testar agora

- Navegação pelas seções e layout responsivo.
- Prévia de jogo Canvas (botão “Jogar prévia”; setas/A-D para mover e Espaço/Seta para cima para pular).
- Configurações de acessibilidade: botão de engrenagem, tema escuro, redução de animação e fonte maior. As preferências são locais ao navegador.
- Cadastro/entrada: os formulários chamam a API local e já foram testados com PostgreSQL persistente (cadastro, logout e login).
- Painel: a última leitura vem da API e o histórico já foi confirmado visualmente com três leituras sintéticas de teste.
- Bluetooth: a integração Web Bluetooth está preparada no site e os UUIDs coincidem com o firmware. A conexão física ainda não foi testada porque a pulseira está em montagem.
- Diagnóstico: o painel da família mostra suporte ao Web Bluetooth, estado da NeuroBand, etapas GATT, notificações, último pacote recebido, persistência na API e tentativas de reconexão. O botão “Testar API” verifica o backend sem expor segredos.

## 3. Backend/API (não é necessário para abrir a página)

O backend está em `server` e usa Node.js, Fastify e PostgreSQL. Nesta máquina, o banco `neurobloom` já foi criado, o schema foi aplicado e as permissões do usuário da API foram configuradas. Cadastro, login, sessão, consulta da família e histórico de leituras já foram testados localmente.

### Preparar

1. Instale PostgreSQL 16+ e crie um banco vazio chamado `neurobloom` e usuário/senha locais.
2. Copie `server\.env.example` para `server\.env`.
3. Edite `.env` com `DATABASE_URL=postgres://USUARIO:SENHA@localhost:5432/neurobloom`, um `JWT_SECRET` aleatório longo, `DEVICE_INGEST_SECRET` aleatório e `FRONTEND_ORIGIN=http://localhost:5500`.
4. No PowerShell:
   ```powershell
   cd "$env:USERPROFILE\Downloads\NeuroBloom\server"
   npm install
   ```
5. No psql/pgAdmin, execute o conteúdo de `schema.sql` no banco neurobloom.
6. Inicie com `npm start`. A API escuta em http://127.0.0.1:3333.
7. Em outra janela, abra http://localhost:3333/api/health. Um `ok:true` confirma que o processo responde; não prova que todas as integrações estejam prontas.

**Importante:** o frontend já possui integração local com os endpoints de autenticação/família e consulta de leitura. PagBank checkout/webhook está deliberadamente desativado (HTTP 501) até implementar a validação oficial de assinatura, idempotência e credenciais sandbox. SMTP só funciona após configurar um provedor de e-mail no .env. Nunca coloque tokens no JavaScript do navegador ou envie credenciais para o chat.

## 4. Guia de bancada — ESP32 + MAX30102

A pulseira física não pode ser conectada só pelo site. É necessário montar o circuito e carregar firmware no ESP32.

1. Separe uma placa ESP32, módulo MAX30102, cabos adequados e cabo USB de dados. Confirme a pinagem e tensão do SEU módulo; placas breakout diferem.
2. Em computador de bancada, instale Arduino IDE 2.x.
3. No Arduino IDE, instale o pacote de placas “esp32 by Espressif Systems” pelo Boards Manager. Selecione o modelo exato da placa e a porta COM que aparece ao conectar USB.
4. No Library Manager, instale uma biblioteca compatível com MAX3010x (por exemplo, SparkFun MAX3010x Sensor Library).
5. Comece com um exemplo de leitura/identificação do sensor e abra Tools > Serial Monitor. Use a velocidade indicada pelo exemplo. Confirme que o sensor responde e observe valores apenas para fins experimentais.
6. Antes de criar a integração web, escolha e documente um protocolo:
   - BLE GATT: definir UUID de serviço e característica, formato da mensagem e permissões; o firmware e o frontend têm de usar os mesmos UUIDs.
   - Wi-Fi/HTTPS: firmware envia leituras à API por TLS com autenticação individual. Não use segredo compartilhado embutido em firmware distribuído.
7. O site atual já implementa Web Bluetooth com os mesmos UUIDs do firmware: serviço `7b6e1000-8d4a-4a7f-9b31-0b6e2a1c1000` e característica `7b6e1001-8d4a-4a7f-9b31-0b6e2a1c1000`. O navegador recebe o pacote de 3 bytes (BPM uint16 little-endian + qualidade uint8) e envia a leitura ao endpoint autenticado de persistência. A conexão física ainda precisa ser testada com a pulseira montada. O firmware agora não envia pacote BLE enquanto ainda não houver batimento válido, evitando transmitir BPM=0 como se fosse uma leitura.
8. Faça testes apenas em bancada. Não use em criança nem tome decisões de saúde a partir das leituras. MAX30102/ESP32 não são dispositivo médico validado; movimento, ajuste e qualidade de contato podem gerar resultados incorretos.

## 5. Limites de segurança e privacidade

NeuroBloom é um protótipo escolar. Não é dispositivo médico, não diagnostica autismo nem qualquer condição, não identifica emergência e não substitui profissionais de saúde. Não use limiares de BPM como alerta clínico. Antes de qualquer piloto real com menores, são necessários consentimento verificável do responsável, avaliação LGPD, segurança, retenção/exclusão de dados, testes independentes do hardware e supervisão apropriada.

## 6. Problemas comuns

- “Porta 5500 em uso”: escolha outra porta, por exemplo `py -m http.server 8080`, e acesse http://localhost:8080.
- Página sem estilo: confirme que `styles.css` está na mesma pasta de `index.html`.
- API não inicia: confira se PostgreSQL está ativo, URL e credenciais em `.env`, se executou `schema.sql` e se npm install terminou sem erros.
- Sensor não aparece: confira cabo USB de dados, driver/porta COM, placa selecionada, alimentação e conexões I²C conforme documentação do módulo.
