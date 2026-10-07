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
- Login familiar usa `nb_session` por 20 minutos; login infantil usa `nb_kid_session` por 30 minutos. Cada middleware verifica o cookie próprio, assinatura, expiração e papel. As sessões podem coexistir no mesmo navegador.
- Logout limpa o cookie correspondente. Família e perfil infantil exigem uma conta que ainda exista no banco.
- Senhas e PINs são armazenados com Argon2; respostas de autenticação não retornam os hashes.

`npm test` executa os testes de autenticação, isolamento de sessões, cookies, CORS/Origin, códigos HTTP, indisponibilidade e encerramento do servidor, sem depender de banco.

`npm run test:integration` usa `TEST_DATABASE_URL` ou o PostgreSQL local definido no `.env`. Cria um schema temporário exclusivo, valida cadastro/login/família/PIN, persistência entre instâncias, duplicidade e rollback e remove somente esse schema ao terminar. Bancos remotos são ignorados automaticamente; as contas existentes não são usadas nem alteradas.

Rotas preservadas: leituras recentes/históricas, ingestão BLE, cadastro de dispositivo e ingestão com segredo individual, teste de e-mail se SMTP configurado. `DEVICE_INGEST_SECRET` global não é necessário; cada dispositivo recebe seu segredo na rota `device-enrollment`.

Ainda pendentes: verificação de e-mail/recuperação de senha, checkout PagBank/webhook (HTTP 501), autorização de jogos, protocolo ESP32 final, backups/retenção e revisão para uso com dados reais.

Privacidade: dados de criança e sinais fisiológicos são sensíveis. O ambiente de demonstração deve usar dados fictícios até concluir consentimento verificável, minimização, retenção/exclusão, análise de risco e conformidade LGPD. O MAX30102 não é equipamento médico por si só.
