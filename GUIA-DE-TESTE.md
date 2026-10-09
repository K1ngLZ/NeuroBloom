# NeuroBloom — guia de desenvolvimento e conexão

## Site online

Abra https://neuro-bloom-swart.vercel.app. O cadastro, login, jogos e dados familiares usam a API e o PostgreSQL na Railway. Visitantes não precisam iniciar servidor local.

Para a NeuroBand, entre no painel do responsável, abra **NeuroBand** e use **Conectar pulseira**. O caminho é **ESP32 → Bluetooth do aparelho → navegador → API HTTPS → PostgreSQL**. Mantenha a aba aberta durante a coleta. O servidor online não consegue usar o rádio Bluetooth de um aparelho remoto por conta própria.

Use Chrome/Edge no Windows ou macOS, ou Chrome no Android, com Web Bluetooth disponível. Chrome e Safari no iPhone/iPad não oferecem esse acesso, mesmo com Bluetooth ligado. Nesses aparelhos, o [Bluefy](https://apps.apple.com/us/app/bluefy-web-ble-browser/id1492822055) oferece a API Web Bluetooth: abra o endereço HTTPS do NeuroBloom dentro dele, entre na conta do responsável, autorize Bluetooth e escolha a NeuroBand pela janela do site. Consulte [o guia oficial do Bluefy](https://bluefy.app/guide.html). O pareamento físico da NeuroBand nesse navegador ainda precisa ser confirmado; não foi testado nesta máquina. Navegadores sem a API exibem a orientação específica no painel; o site verifica a API antes de usar o tipo do aparelho para escolher a mensagem.

## Preparar o desenvolvimento local

Na pasta do projeto:

```powershell
node scripts/build-web.mjs
node scripts/dev-web.mjs
```

Abra http://localhost:5500. O servidor publica somente a pasta `public/` preparada pelo build; arquivos de backend, `.env`, backups e modelos de voz ficam fora dela. Para encerrar, pressione Ctrl+C no terminal.

A API local escuta na porta 3333. Configure PostgreSQL 16+, copie `server/.env.example` para `server/.env` e defina `DATABASE_URL`, `JWT_SECRET` aleatório e `FRONTEND_ORIGIN=http://localhost:5500`. Em `server/`:

```powershell
npm ci
npm run db:migrate
npm run dev
```

`GET http://localhost:3333/api/health` confirma banco e tabelas disponíveis. A migração preserva contas e adiciona as tabelas de jogos e conexões BLE. Não compartilhe `.env` ou segredos no chat. Instruções de hospedagem: [DEPLOY.md](DEPLOY.md).

## Firmware e pareamento físico

Consulte [hardware/neuroband/README.md](hardware/neuroband/README.md) para circuito, placa, biblioteca, UUIDs e gravação do firmware. O código já compila para ESP32 Dev Module clássico; a conexão física precisa ser confirmada na placa montada. Não carregue firmware em uma porta COM cuja placa não foi identificada.

1. Monte ESP32 + MAX30102 e confirme alimentação, I2C e modelo da placa.
2. Carregue `hardware/neuroband/neuroband.ino` e confira o monitor serial a 115200 baud. O anúncio deve aparecer como `NeuroBand-XXXX`.
3. Abra o site HTTPS perto da pulseira, entre como responsável e escolha **Conectar pulseira**. Selecione o anúncio correspondente à sua placa na janela do navegador.
4. Confira conexão, GATT e notificações no painel. Sem sensor/contato válido, a conexão pode estar ativa, mas o BPM continua aguardando.
5. Quando houver batimento válido, confira BPM/índice de contato, confirmação de envio e histórico. O envio ocorre em lotes a cada cinco segundos. Retirar o contato interrompe notificações; após 15 segundos, o painel deixa de exibir o valor como leitura recente.
6. Desligue a pulseira e ligue novamente para conferir reconexão automática. Teste uma interrupção breve de internet: a fila em memória guarda até 120 amostras por até cinco minutos e repete os mesmos IDs sem duplicar o histórico.
7. Use **Desconectar** antes de sair. Fechar a aba, encerrar a conta ou desconectar descarta amostras ainda não confirmadas. Verifique que o histórico confirmado permanece disponível ao entrar novamente.

BLE é próximo ao aparelho que abriu o site, depende do rádio/permissões e do firmware NeuroBand. Não se trata de um conector genérico para qualquer relógio Bluetooth. O nome do dispositivo e seu ID do navegador são metadados; o firmware atual não oferece identidade criptográfica do hardware.

## Verificação de software

```powershell
node --test scripts/ble.test.mjs scripts/ble-cloud.test.mjs scripts/ble-portal.test.mjs scripts/build-web.test.mjs
npm --prefix server test
npm --prefix server run test:integration
```

Os testes BLE usam rádio sintético: cobrem o primeiro pacote, desconexão durante uma operação, reconexão, fila entre controladores, lote repetido, rede indisponível, expiração e logout. Os testes de integração usam schema temporário em PostgreSQL local, isolado das contas existentes; validam persistência, propriedade, concorrência e rollback. Testes de software não comprovam pareamento nem precisão do sensor real.

## Problemas comuns

- **Bluetooth indisponível:** use navegador compatível e HTTPS/localhost, ative Bluetooth e confira permissões do sistema. A seleção exige clicar no botão do site.
- **NeuroBand não aparece:** confira firmware, cabo de dados, placa, nome no monitor serial e proximidade. O anúncio inicia mesmo sem sensor e retorna cerca de 500 ms após desconexão.
- **Conecta sem BPM:** confira sensor/I2C e contato óptico; o firmware não envia zeros como medição.
- **API indisponível:** confira `/api/health`, conexão com internet e diagnóstico de persistência. No desenvolvimento local, confirme PostgreSQL, `.env` e migração.
- **Sessão expirada:** entre novamente; cookies expirados não podem ser renovados. O painel renova uma sessão válida ao abrir e a cada oito minutos.
- **Porta 5500 ocupada:** encerre o servidor anterior ou use uma porta/origem local permitida pela API.

A NeuroBloom não é um dispositivo médico validado. O índice de contato não representa precisão clínica ou detecção de estresse. Montagem, sinal e segurança precisam de validação independente; não use as leituras para decisões clínicas ou emergências. SMTP e cobrança/PagBank seguem pendentes.
