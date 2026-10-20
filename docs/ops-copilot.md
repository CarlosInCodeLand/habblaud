# Ops Copilot no Habblaud (fork read-only)

Este fork adiciona o provider **ops** ao Habblaud para visualizar agentes do Ops Copilot. O chat e as aprovações continuam no Telegram/OpenClaw.

## Dia 1 — modo fake

Liga uma fonte fake, sem SSE, sem tokens e sem escrita:

    HABBLAUD_OPS_FAKE=1 npm run dev

Abra http://localhost:4747. Deve aparecer um agente na sala **ops-copilot**, alternando:

- consulta GAM;
- SQL read-only;
- espera de aprovação no Telegram;
- atualização de card no Todoist;
- consulta Meta;
- turno concluído.

O ciclo é só visual. Nada é executado de verdade.

## Segurança

- HABBLAUD_TERMINAL=0, HABBLAUD_MENSAGENS=0, HABBLAUD_PTY=0.
- Bind local (HABBLAUD_BIND=127.0.0.1).
- Sem aprovação, terminal ou mensagens para o provider ops.
- Sem segredos: a fonte fake não lê arquivos nem chama APIs.

## Próximo passo

Substituir a fonte fake pelo stream SSE /api/ops/events do Ops MCP (Dia 2 do mini-plano) e mapear run/step/subagent/approval. Ver:

- docs/adr/0002-habblaud-fork-visual-office.md no repo ops-copilot;
- docs/superpowers/plans/2026-10-21-habblaud-fork.md.
