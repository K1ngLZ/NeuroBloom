# NeuroBloom API

Node.js 22+ / Fastify / PostgreSQL. As contas ficam no PostgreSQL configurado por `DATABASE_URL`; o navegador guarda somente cookies de sessão HTTP-only.

## Executar localmente

1. Copie `.env.example` para `.env` dentro de `server/` e configure um PostgreSQL local.
2. Gere `JWT_SECRET` aleatório com pelo menos 32 caracteres, por exemplo: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Nunca envie `.env` ao Git ou compartilhe o segredo.
3. Execute `npm ci`, `npm run db:migrate` e `npm run dev`, a partir de `server/`.
4. Abra o frontend em `http://localhost:5500` ou `http://127.0.0.1:5500`; cada origem usada deve estar em `FRONTEND_ORIGIN`.

`GET /api/health` retorna HTTP 200 e `ok:true` quando o banco e as tabelas de autenticação/família estão disponíveis. Retorna HTTP 503 e `ok:false` caso a conexão ou o schema falhe.

## Executar online

Use PostgreSQL persistente hospedado e forneça as variáveis no serviço de hospedagem. `npm run start:prod` aplica `schema.sql` antes de iniciar a API. O schema usa `CREATE ... IF NOT EXISTS` e preserva as contas existentes. A API escuta em `0.0.0.0` e respeita `PORT` fornecida pela hospedagem.

| Variável | Configuração |
| --- | --- |
| `NODE_ENV` | `production` para cookies `Secure` enviados por HTTPS |
| `DATABASE_URL` | URL privada do PostgreSQL hospedado; nunca apontar para o computador pessoal |
| `JWT_SECRET` | Segredo aleatório persistente; trocar o valor encerra as sessões existentes |
| `FRONTEND_ORIGIN` | Origem HTTPS exata do frontend, sem `/` final; várias origens separadas por vírgula |
| `SESSION_COOKIE_SAME_SITE` | `lax` quando o frontend encaminha `/api` pelo próprio domínio; valor padrão |
| `TRUST_PROXY` | Número de proxies confiáveis na infraestrutura, por exemplo `1` no serviço configurado; padrão local `0` |
| `HOST` / `PORT` | `0.0.0.0` / porta definida pela hospedagem |

Prefira servir as chamadas `/api/*` pelo mesmo domínio do frontend, com proxy/rewrite para a API. Isso permite que cookies sejam usados em diferentes computadores sem depender de cookies de terceiros. O acesso direto entre sites exige `SESSION_COOKIE_SAME_SITE=none`, HTTPS e `NODE_ENV=production`, e ainda depende das políticas de cookies do navegador. Cookies nunca são enviados ao JavaScript.

O servidor recusa inicialização sem banco, segredo forte ou origem HTTPS em produção. As operações de escrita vindas de navegador validam `Origin`, o CORS aceita apenas origens configuradas e signup/login/PIN permitem no máximo 10 tentativas por minuto por IP. `SIGINT` e `SIGTERM` fecham conexões e o listener.

## Autenticação e testes

- Cadastro valida nomes, e-mail, senha de 12 a 128 caracteres, PIN de 6 a 32 caracteres e consentimento. E-mail é normalizado com trim e lowercase. Responsável e criança são criados na mesma transação; e-mail duplicado retorna HTTP 409.
- Login familiar usa `nb_session` por 20 minutos; login infantil usa `nb_kid_session` por 30 minutos. Cada middleware verifica o cookie próprio, assinatura, expiração e papel. As sessões podem coexistir no mesmo navegador. `POST /api/auth/refresh` renova somente uma sessão válida do responsável cuja conta ainda existe. O painel chama a renovação a cada oito minutos.
- Logout limpa o cookie correspondente. Família e perfil infantil exigem uma conta que ainda exista no banco.
- Senhas e PINs são armazenados com Argon2; respostas de autenticação não retornam os hashes.

`npm test` executa os testes de autenticação, isolamento de sessões, cookies, CORS/Origin, códigos HTTP, indisponibilidade e encerramento do servidor, sem depender de banco.

`npm run test:integration` usa `TEST_DATABASE_URL` ou o PostgreSQL local definido no `.env`. Cria um schema temporário exclusivo, valida cadastro/login/família/PIN, persistência entre instâncias, duplicidade e rollback e remove somente esse schema ao terminar. Bancos remotos são ignorados automaticamente; as contas existentes não são usadas nem alteradas.

Rotas preservadas: leituras recentes/históricas, ingestão BLE, cadastro de dispositivo e ingestão com segredo individual, teste de e-mail se SMTP configurado. `DEVICE_INGEST_SECRET` global não é necessário; cada dispositivo recebe seu segredo na rota `device-enrollment`.

Ainda pendentes: verificação de e-mail/recuperação de senha, checkout PagBank/webhook (HTTP 501), validação física do ESP32/sensor, backups/retenção e revisão para uso com dados reais.

Privacidade: dados de criança e sinais fisiológicos são sensíveis. O ambiente de demonstração deve usar dados fictícios até concluir consentimento verificável, minimização, retenção/exclusão, análise de risco e conformidade LGPD. O MAX30102 não é equipamento médico por si só.
## NeuroBand BLE

O aparelho com o navegador faz a ponte Bluetooth → HTTPS; o servidor recebe os dados pela sessão do responsável. Todas as rotas abaixo exigem `nb_session` e propriedade do perfil infantil. Cookies infantis recebem 401; perfis de outra família recebem 404. O identificador Bluetooth é armazenado como SHA-256 e não prova a autenticidade do hardware.

| Método e rota (prefixo `/api/children/:id`) | Corpo / resultado |
| --- | --- |
| `POST /ble/sessions` | `{ deviceId, deviceName, connectionId? }`; retorna 201 `{ session, protocol }`. `connectionId` UUID torna novas tentativas idempotentes. |
| `GET /ble/status` | Última `{ session, connected }`; sem conexão retorna `session:null`. |
| `POST /ble/sessions/:sessionId/heartbeat` | Renova `last_seen` da conexão aberta. |
| `POST /ble/sessions/:sessionId/end` | Encerra a conexão; repetir é permitido. |
| `POST /vitals/ble` | `{ sessionId, readings:[{ readingId, bpm, signalQuality, measuredAt }] }`; retorna 202 `{ accepted, saved, duplicates }`. |

Lotes aceitam 1–20 amostras, BPM inteiro 25–250, índice 0–100 e timestamp ISO entre cinco minutos atrás e 30 segundos à frente. `readingId` UUID é único por criança, inclusive entre sessões: repetir um lote não duplica o histórico. A transação bloqueia a sessão até inserir o lote inteiro, evitando escrita após encerramento e salvamento parcial. O formato antigo com uma leitura sem `sessionId` continua aceito durante a atualização do frontend.

`connected` representa o heartbeat da ponte do navegador: após 65 segundos sem contato, o estado é `stale`; após cinco minutos sem atividade, escritas retornam 410. Sessões encerradas retornam 409 e exigem nova abertura. Isso não é verificação independente do rádio nem da presença no pulso. Limite compartilhado: 90 chamadas BLE/minuto por responsável autenticado, para que famílias na mesma rede não disputem a quota por IP.

`GET /vitals/latest` e `/vitals` incluem `source`, `ble_session_id` e `client_reading_id`; dados existentes são preservados pela migração. O frontend mantém fila curta em memória e repete lotes com os mesmos IDs quando perde a resposta. Renovação de login, parada, desconexão e reconexão são testadas sem dispositivos reais. Consulte [o firmware](../hardware/neuroband/README.md) para montagem e protocolo GATT.

## Progresso dos jogos

`GET /api/children/me/game-progress` retorna `{ "progress": { "platform": { ... } } }`.
`PUT /api/children/me/game-progress/:gameId` recebe `{ "progress": { ... } }` e retorna `{ "ok": true }`.
Os jogos aceitos são `platform`, `speed`, `ninja`, `sword` e `energy`. Os dois endpoints exigem o cookie HTTP-only `nb_kid_session`; o ID da criança sempre vem dessa sessão, nunca do corpo da requisição. O cookie do responsável não dá acesso a estas rotas.
Cada progresso deve ser um objeto JSON de até 8192 bytes UTF-8, com no máximo seis níveis aninhados e números finitos. Escritas substituem o progresso daquele jogo e daquela criança. A migração idempotente cria `game_progress`, com exclusão em cascata ao remover a criança.

### Apelido e histórico privado dos jogos

Estes endpoints usam exclusivamente o cookie infantil `nb_kid_session`. IDs de criança não são aceitos no corpo. O apelido começa como `null`, nunca deriva do nome real e pode ser repetido por outras crianças; não há ranking ou busca pública.

- `GET /api/children/me/game-profile`: `{ nickname: string | null, canEdit: true }`.
- `PATCH /api/children/me/game-profile`: corpo `{ nickname }`, com 3–20 caracteres Unicode (letras/números, `_`, `-` e espaços simples). Retorna o perfil atualizado; normaliza NFC e remove espaços externos.
- `POST /api/children/me/game-sessions`: corpo `{ gameId }` entre `platform`, `speed`, `ninja`, `sword`, `energy`. Retorna HTTP 201 `{ session }`; encerra a partida ativa anterior da criança em uma transação serializada.
- `GET /api/children/me/game-sessions`: `{ sessions }`, com as últimas 12 partidas da própria criança, mais recentes primeiro.
- `PATCH /api/children/me/game-sessions/:id`: corpo `{ status: "completed" | "ended", durationSeconds?, score?, level?, stars? }`. Inteiros não negativos com limites 86400, 100000000, 9999 e 3. Retorna `{ session }`; uma partida encerrada é imutável e repetir o encerramento retorna o resultado original. ID de outra criança recebe 404.

Cada `session` contém `id`, `gameId`, `status`, `startedAt`, `endedAt`, `durationSeconds`, `score`, `level`, `stars`. As métricas começam como `null`; duração omitida no encerramento é calculada pelo servidor (máximo 24 horas). Mutações têm limite de 30 requisições/minuto/IP, além do limite geral. Histórico e progresso são removidos em cascata com o perfil infantil. `npm run db:migrate` aplica também essas alterações de forma idempotente a bancos existentes.

Sessions also include `nickname`, a nullable snapshot taken when the session starts; editing the profile only affects future sessions. Existing sessions migrated from older versions have a null snapshot. `POST /api/children/me/refresh` renews a valid, existing child's cookie for 30 minutes (`{ ok: true }`). It cannot renew expired cookies, accepts only the child cookie, and retains the normal origin protection and authentication rate limit.
