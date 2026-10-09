# NeuroBloom online

Frontend: https://neuro-bloom-swart.vercel.app

API: https://neurobloom-api-production.up.railway.app

O navegador envia as chamadas para `/api` no próprio domínio da Vercel. `vercel.json` encaminha para a Railway, preservando cookies no domínio do site. `/responsavel` e `/crianca` devolvem `index.html`, inclusive ao atualizar a página ou abrir um link direto.

## Frontend na Vercel

Repositório: `K1ngLZ/NeuroBloom`, branch de produção `main`, diretório raiz do projeto.

O build configurado em `vercel.json` executa `node scripts/build-web.mjs`. A saída `public/` contém somente HTML, JavaScript, CSS e jogos. Código do servidor, `.env`, banco e backups não são publicados como arquivos do site. Alterar a lista `publicAssets` no script quando novos arquivos públicos forem adicionados.

A API tem um domínio público estável no rewrite. Se mudar esse domínio, atualizar `vercel.json` e publicar novamente. Nunca colocar credenciais do banco ou segredos JWT no frontend.

## Backend na Railway

Projeto existente: `NeuroBloom` (`fe9de2a6-2f5f-4657-bd66-cbff4d4f9ad4`).

Ambiente: `production`. Serviços: `Postgres` e `neurobloom-api`.

Variáveis do serviço da API:

| Nome | Configuração |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | `8080` (domínio Railway encaminha para esta porta) |
| `DATABASE_URL` | Referência privada `${{Postgres.DATABASE_URL}}` |
| `JWT_SECRET` | Segredo aleatório exclusivo de produção, com pelo menos 32 caracteres |
| `FRONTEND_ORIGIN` | `https://neuro-bloom-swart.vercel.app` |
| `SESSION_COOKIE_SAME_SITE` | `lax` para o proxy no próprio domínio |
| `TRUST_PROXY` | Quantidade de proxies confiáveis; revisar ao mudar a hospedagem |

Segredos reais são mantidos nas variáveis da Railway. O `.env` local não deve ser enviado, reutilizado em produção ou exibido.

O `server/Dockerfile` usa Node.js 22 e instala dependências com `npm ci`. `npm run start:prod` aplica o schema idempotente e inicia a API. O healthcheck `/api/health` só retorna HTTP 200 quando o banco e as tabelas de autenticação/família e conexões BLE estão acessíveis. Ao publicar alterações no protocolo da NeuroBand, publique primeiro o backend/migração e depois o frontend.

Publicação manual do backend a partir da raiz do repositório, depois de autenticar a CLI:

```powershell
railway link --project fe9de2a6-2f5f-4657-bd66-cbff4d4f9ad4 --environment production --service neurobloom-api
railway up server --path-as-root --service neurobloom-api --environment production --detach
railway service status --service neurobloom-api --json
```

Esse upload usa `server/` como raiz. Para conectar deploy automático pelo GitHub, configurar a raiz `/server` no serviço Railway e manter o Dockerfile nesse diretório.

Contas cadastradas no PostgreSQL local pertencem àquele banco. Novas contas online são persistidas no banco Railway e funcionam em outros computadores e celulares. Não é necessário migrar dados reais para testar este protótipo.

## Verificação

```powershell
node --test scripts/build-web.test.mjs
cd server
npm test
npm run test:integration
```

O teste de integração usa o banco de desenvolvimento do `.env`, em um schema temporário exclusivo, e remove esse schema ao terminar.

Teste completo do site publicado, a partir da raiz:

```powershell
node scripts/smoke-online.mjs https://neuro-bloom-swart.vercel.app
```

Esse comando cria uma família fictícia com e-mail aleatório `@example.com` no banco online. Verifica cadastro, duplicidade, login, logout, família, histórico, PIN infantil, isolamento das sessões, rotas diretas e ausência dos arquivos privados. Senhas, PINs e cookies ficam apenas em memória, sem aparecer no terminal. Não executar muitas vezes seguidas: as rotas de autenticação limitam tentativas por minuto.

Para validar somente a API, sem páginas do frontend:

```powershell
node scripts/smoke-online.mjs https://neurobloom-api-production.up.railway.app --api-only
```

Também testar no navegador: login → atualizar `/responsavel` → sair → entrar novamente; ID/PIN → atualizar `/crianca` → abrir jogo → sair. Preferências visuais são locais, mas contas e sessões são validadas pelo servidor online.

Validação BLE da API publicada:

```powershell
node scripts/smoke-ble-online.mjs https://neuro-bloom-swart.vercel.app
```

Cria duas famílias fictícias e envia dois pacotes sintéticos. Confere abertura idempotente, lotes, deduplicação, histórico, propriedade do perfil, cookie infantil recusado, timestamp, heartbeat e encerramento. Credenciais ficam em memória; os registros fictícios permanecem isolados no banco online. Esse teste não usa rádio Bluetooth nem comprova pareamento físico. Para isso, siga [o guia da NeuroBand](hardware/neuroband/README.md).
