# NeuroBloom — protótipo escolar

Projeto demonstrativo para o Colégio Módulo da Lapa.

## Abrir

Site público: [neuro-bloom-swart.vercel.app](https://neuro-bloom-swart.vercel.app). O cadastro e o login usam a API e o PostgreSQL hospedados na Railway; quem acessa não precisa instalar nem iniciar nada na própria máquina.

Para desenvolvimento local, siga `GUIA-DE-TESTE.md`. O Bluetooth exige localhost ou HTTPS. Publicação e variáveis de ambiente estão em [DEPLOY.md](DEPLOY.md).

## O que existe nesta versão

- Interface responsiva com tipografia Manrope/Space Grotesk, ilustração da NeuroBand, temas claro e escuro e painéis familiar e infantil refinados.
- Seções sobre o projeto, equipe e Colégio Módulo da Lapa. Biografias são textos de apresentação editáveis; confirmem cada contribuição com os integrantes antes de apresentar como fato.
- Cadastro e login do responsável, sessão em cookie HTTP-only e acesso infantil por ID/PIN, integrados ao PostgreSQL.
- Bloom Arcade com cinco aventuras originais feitas com GPT-6 Astra: Jardins de Aurora, Rastro Solar, Espada da Aurora, Ninja do Vento e Arena Cósmica. Cada campanha tem fases ou missões, controles próprios e conclusão.
- Nickname privado por perfil infantil, histórico das 12 partidas mais recentes (tempo ativo, fase, pontos e estrelas) e progresso persistente no PostgreSQL. Cópia local permite continuar quando a conexão falha; a sincronização exige a sessão infantil.
- Visualização de batimentos demonstrativos.
- Primeira integração Web Bluetooth preparada para receber pacotes da NeuroBand em Chrome/Edge usando os UUIDs definidos no firmware de bancada.
- Navegação por teclado, formulários com foco acessível, controles de toque na prévia e preferências locais de fonte e animação.

O sistema visual da página está em `premium.css` e o dos portais em `portal-premium.css`, carregados após a folha de estilos original. As integrações e o conteúdo do projeto foram preservados.

## Antes de qualquer uso real

Este protótipo não é dispositivo médico, não diagnostica nem detecta emergências. MAX30102 exige validação de hardware, filtragem de sinal, calibração e testes independentes. Não use leituras ou limiares deste site para decisões clínicas. Um sensor óptico no pulso pode produzir leituras erradas por movimento, ajuste, perfusão e outras condições. O aviso deve instruir o responsável a buscar orientação profissional e serviços de emergência quando necessário.

Não inserir dados reais de crianças. PostgreSQL, autenticação, família e histórico de leituras são testados com dados fictícios. A integração Web Bluetooth está preparada no frontend e o firmware compila, mas a conexão física com a pulseira ainda depende da montagem/USB/ESP32. SMTP e cobrança/PagBank ainda não estão concluídos. Não armazene credenciais ou dados sensíveis em localStorage ou código do navegador.

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
2. Finalizar a integração física: ESP32 + MAX30102, BLE GATT, leitura no navegador e persistência no PostgreSQL.
3. Configurar SMTP para demonstração de notificação e depois implementar PagBank somente com documentação oficial, sandbox e webhook validado.
4. Fazer testes de bancada e validação independente do sensor e dos alertas antes de qualquer uso com crianças.
5. Para produção, revisar autenticação, consentimento, retenção/exclusão e requisitos LGPD antes de aceitar dados reais.

## Desenvolvimento dos jogos

Prepare os arquivos públicos com `node scripts/build-web.mjs` e abra `node scripts/dev-web.mjs` (porta 5500). A API local usa a porta 3333; em produção os jogos acessam `/api` pelo mesmo domínio do site. Jogar sem login funciona, com salvamento apenas no aparelho.

Teclado: setas/WASD para mover, Espaço para salto ou voo, J para ataque, L para especial, Shift para esquiva/turbo, I para defesa, E para interação. O guia de cada jogo mostra as ações disponíveis; celular tem controles de toque. Som começa desligado, a simulação pausa ao sair da aba e respeita a preferência de reduzir movimento.

Validação: `node --test scripts/build-web.test.mjs scripts/games.test.mjs scripts/runtime.test.mjs`, `npm --prefix server test` e `npm --prefix server run test:integration`. O teste `node scripts/smoke-games-online.mjs` cria dois perfis fictícios na publicação para verificar isolamento, nickname, sessões e progresso; não use dados pessoais para QA.
