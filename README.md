# NeuroBloom

Projeto de tecnologia, cuidado e inclusão criado no Colégio Módulo da Lapa, com a NeuroBand, o painel familiar e o Bloom Arcade.

## Abrir

Site público: [neuro-bloom-swart.vercel.app](https://neuro-bloom-swart.vercel.app). O cadastro e o login usam a API e o PostgreSQL hospedados na Railway; quem acessa não precisa instalar nem iniciar nada na própria máquina.

Para desenvolvimento local, siga `GUIA-DE-TESTE.md`. O Bluetooth exige localhost ou HTTPS. Publicação e variáveis de ambiente estão em [DEPLOY.md](DEPLOY.md).

## O que existe nesta versão

- Interface responsiva com tipografia Manrope/Space Grotesk, ilustração da NeuroBand, temas claro e escuro e painéis familiar e infantil refinados.
- Seções sobre o projeto, equipe e Colégio Módulo da Lapa. Biografias são textos de apresentação editáveis; confirmem cada contribuição com os integrantes antes de apresentar como fato.
- Cadastro e login do responsável, sessão em cookie HTTP-only e acesso infantil por ID/PIN, integrados ao PostgreSQL.
- Bloom Arcade com cinco aventuras originais feitas com GPT-6 Astra: Jardins de Aurora, Rastro Solar, Espada da Aurora, Ninja do Vento e Arena Cósmica. Cada campanha tem fases ou missões, controles próprios e conclusão.
- Nickname privado por perfil infantil, histórico das 12 partidas mais recentes (tempo ativo, fase, pontos e estrelas) e progresso persistente no PostgreSQL. Cópia local permite continuar quando a conexão falha; a sincronização exige a sessão infantil.
- Página inicial com estados de espera, sem valores de batimentos inventados. O painel familiar mostra as leituras recebidas pela API ou pela NeuroBand.
- Passeio animado da Lumi na página inicial: embarque no foguete, cinco jogos, apelido/conquistas, NeuroBand e painel familiar, com voz neural em português, legendas e atalho para o portal infantil. O áudio começa quando a pessoa escolhe assistir; o vídeo pode ser visto novamente pelo controle de replay.
- Integração NeuroBand → Web Bluetooth → API Railway → PostgreSQL. O painel familiar mostra conexão, notificações, última leitura e confirmação do servidor, com reconexão automática e envio em lotes sem duplicar registros.
- Navegação por teclado, formulários com foco acessível, controles de toque na prévia e preferências locais de fonte e animação.

O sistema visual da página está em `premium.css` e o dos portais em `portal-premium.css`, carregados após a folha de estilos original. As integrações e o conteúdo do projeto foram preservados.

## Passeio espacial da Lumi

O vídeo da página inicial usa `assets/mascot/welcome.mp4`, a capa `assets/mascot/welcome-poster.jpg` e as legendas `assets/mascot/welcome.vtt`. A reprodução com voz exige uma ação da pessoa e oferece controle para rever a apresentação. O convite para entrar no espaço infantil continua disponível junto ao vídeo.

O roteiro está em `scripts/mascot-story.json`. A narração usa o modelo neural [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), voz brasileira feminina `pf_dora`, via [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx). Os fonemas e seus tempos controlam a abertura e o formato da boca. A animação original preserva a Lumi em lilás e menta, mostra o embarque/decolagem e apresenta cada aventura. A NeuroBand é descrita com registros disponíveis quando conectada, sem simular leituras reais.

Para gerar novamente no Windows com Python 3.11:

```powershell
python -m venv .cache/mascot/venv
.cache/mascot/venv/Scripts/python.exe -m pip install -r scripts/requirements-mascot.txt
python scripts/setup-mascot-models.py
powershell -File scripts/generate-mascot-voice.ps1
.cache/mascot/venv/Scripts/python.exe scripts/render-mascot-video.py --preview-only
.cache/mascot/venv/Scripts/python.exe scripts/render-mascot-video.py
```

O download usa os dois arquivos da [release oficial ONNX model-files-v1.1](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1), com verificação SHA-256. Pesos do modelo: Apache-2.0; inferência: MIT. O ambiente, pesos, WAVs, storyboard e relatórios de voz/render ficam em `.cache/mascot`, ignorada pelo Git. Não é necessário contratar API ou fornecer credenciais; a geração ocorre no ambiente de desenvolvimento, e visitantes recebem o MP4 pronto, sem instalar nada.

A publicação entrega vídeo H.264 com áudio AAC e permite apenas os três arquivos finais listados acima. Scripts, modelos e arquivos de trabalho ficam fora do build público. A opção `--preview-only` gera uma folha de cenas para revisar antes de renderizar. Reprodução exige uma ação, possui pausa, replay, legendas opcionais e transcrição; pausa ao sair da tela, ocultar a página ou abrir o portal/login.

## Antes de qualquer uso real

A NeuroBloom não é dispositivo médico, não diagnostica nem detecta emergências. MAX30102 exige validação de hardware, filtragem de sinal, calibração e testes independentes. Não use leituras ou limiares deste site para decisões clínicas. Um sensor óptico no pulso pode produzir leituras erradas por movimento, ajuste, perfusão e outras condições. O aviso deve instruir o responsável a buscar orientação profissional e serviços de emergência quando necessário.

Os testes de PostgreSQL, autenticação, família e histórico de leituras usam dados fictícios. A integração BLE está implementada no frontend e no backend e o firmware foi compilado para ESP32 clássico. A confirmação do pareamento físico e do sinal óptico depende de uma placa montada com o firmware carregado. SMTP e cobrança/PagBank ainda não estão concluídos. Não armazene credenciais ou dados sensíveis em localStorage ou código do navegador.

## Conexão da NeuroBand

Entre no [painel familiar online](https://neuro-bloom-swart.vercel.app/responsavel), abra **NeuroBand** e toque em **Conectar pulseira** no Chrome/Edge em Windows/Mac, Chrome no Android ou Bluefy no iPhone/iPad, com Web Bluetooth disponível. Chrome e Safari no iPhone/iPad não oferecem esse acesso; habilitar Bluetooth não adiciona a API ao navegador. Escolha `NeuroBand-XXXX` e mantenha esta aba aberta. A pulseira se comunica com o Bluetooth do aparelho próximo; o site encaminha as leituras à API pela internet. A Railway não tem acesso direto ao rádio Bluetooth. A compatibilidade física da NeuroBand com Bluefy precisa ser conferida na placa real; o navegador declara suporte à API, mas não houve pareamento físico neste ambiente.

O protocolo usa três bytes: BPM `uint16` little-endian e índice de contato óptico `uint8` (0–100). A montagem, os UUIDs e a compilação estão no [guia do firmware](hardware/neuroband/README.md). O anúncio inicia mesmo sem sensor; nesse caso haverá conexão, mas nenhuma leitura válida.

As amostras têm identificadores únicos, são enviadas a cada cinco segundos em lotes de até 20 e ficam vinculadas exclusivamente ao perfil do responsável autenticado. Falhas transitórias mantêm até 120 amostras por no máximo cinco minutos em memória, sem gravar sinais fisiológicos em localStorage. Fechar a aba, sair da conta ou desconectar descarta amostras ainda não confirmadas. O navegador renova a sessão da conta enquanto o painel está aberto; cookies expirados exigem novo login.

Validação de software: `node --test scripts/ble.test.mjs scripts/ble-cloud.test.mjs scripts/ble-portal.test.mjs`, `npm --prefix server test` e `npm --prefix server run test:integration`. Os testes cobrem notificações, reconexão, requisições em andamento, respostas perdidas, duplicações, transações e isolamento entre famílias. Eles não substituem o pareamento e a medição no hardware real.

## Arquitetura recomendada para evolução

- Frontend: HTML, CSS, JavaScript; futuramente TypeScript e framework se desejado.
- Backend: Node.js + Express ou Fastify, HTTPS, validação de entrada e autorização por papéis.
- Banco: PostgreSQL gerenciado; senha com Argon2id/bcrypt, sessões seguras, MFA do responsável e logs mínimos.
- Telemetria: ESP32 lê MAX30102, aplica processamento validado e envia via Wi-Fi usando TLS para API autenticada. BLE Web Bluetooth pode servir para pareamento local em navegadores compatíveis, mas exige HTTPS e permissão explícita.
- Alertas: serviço de e-mail transacional pelo backend; não enviar dados de saúde desnecessários por e-mail. Link com token de uso único e expiração, autenticação exigida no painel.
- Pagamento: checkout PagBank/PagSeguro no backend, usando documentação oficial atual, credenciais em variáveis de ambiente e webhook assinado/idempotente. Nunca confiar em retorno do navegador para ativar assinatura.
- Privacidade: consentimento verificável do responsável, minimização, retenção definida, exclusão/exportação, controle de acesso e revisão jurídica LGPD para dados pessoais sensíveis de crianças.

## Próximos passos de integração

1. Ampliar os cinco mundos com novas fases, personagens originais e testes de experiência com jogadores.
2. Carregar o firmware na placa identificada, conferir a montagem ESP32 + MAX30102 e validar o pareamento físico e as leituras no site online.
3. Configurar SMTP para demonstração de notificação e depois implementar PagBank somente com documentação oficial, sandbox e webhook validado.
4. Fazer testes de bancada e validação independente do sensor e dos alertas antes de qualquer uso com crianças.
5. Para produção, revisar autenticação, consentimento, retenção/exclusão e requisitos LGPD antes de aceitar dados reais.

## Desenvolvimento dos jogos

Prepare os arquivos públicos com `node scripts/build-web.mjs` e abra `node scripts/dev-web.mjs` (porta 5500). A API local usa a porta 3333; em produção os jogos acessam `/api` pelo mesmo domínio do site. Jogar sem login funciona, com salvamento apenas no aparelho.

Teclado: setas/WASD para mover, Espaço para salto ou voo, J para ataque, L para especial, Shift para esquiva/turbo, I para defesa, E para interação. O guia de cada jogo mostra as ações disponíveis; celular tem controles de toque. Som começa desligado, a simulação pausa ao sair da aba e respeita a preferência de reduzir movimento.

Validação: `node --test scripts/build-web.test.mjs scripts/games.test.mjs scripts/runtime.test.mjs`, `npm --prefix server test` e `npm --prefix server run test:integration`. O teste `node scripts/smoke-games-online.mjs` cria dois perfis fictícios na publicação para verificar isolamento, nickname, sessões e progresso; não use dados pessoais para QA.
