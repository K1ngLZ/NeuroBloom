# NeuroBloom API (fase inicial)

Node.js 20+ / Fastify / PostgreSQL.

1. Instale PostgreSQL e crie database e usuário dedicados.
2. Copie `.env.example` para `.env` e gere segredos aleatórios fortes para JWT_SECRET e DEVICE_INGEST_SECRET. Nunca envie `.env` ao Git nem compartilhe segredos.
3. Execute `npm install` e aplique `schema.sql` no banco escolhido.
4. `npm run dev` inicia em localhost:3333. `GET /api/health` verifica serviço.
5. Configure HTTPS, domínio, backups, monitoramento, política de privacidade e revisão de segurança antes de hospedar publicamente.

Rotas atuais: cadastro/login familiar (cookie HTTP-only), logout, dados da família, login infantil por PIN, leituras recentes e históricas, cadastro de dispositivo e ingestão autenticada, teste de e-mail se SMTP configurado.

Ainda NÃO concluídos: checkout PagBank e webhook (rotas retornam 501 deliberadamente), alerta automático por regras clínicas (não implementar sem validação profissional), verificação de e-mail/recuperação de senha, sessão infantil com middleware dedicado e autorização de jogos, integração BLE no frontend, protocolo ESP32 final, rate limiting específico por endpoint, migrações/backups e teste de segurança.

Privacidade: dados de criança e sinais fisiológicos são sensíveis. Não operar com crianças reais até concluir consentimento verificável do responsável, minimização, controle de acesso, criptografia/gestão de segredos, retenção/exclusão, análise de risco e conformidade LGPD. O sensor MAX30102 não é equipamento médico por si só.
