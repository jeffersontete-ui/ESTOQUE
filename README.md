# ESTOQUE — balcão

App web (PWA) do estoque manual da farmácia. Roda no GitHub Pages, guarda os
dados no Firebase Realtime Database do projeto `estoque-remedios-7b785`.

Este repositório é o **balcão**. A conferência do SNGPC fica no repositório
separado **FARMACIA-SNGPC**, com senha própria.

## O que ele faz

- cadastro manual de itens (nome, código de barras, M.S., lote, validade, mínimo, local);
- alertas de vencido, vencendo (90 dias) e estoque baixo;
- lista de compras, com botão para puxar tudo que está abaixo do mínimo;
- modo contagem: conta a prateleira inteira e só grava no fim, cada diferença virando movimentação;
- histórico com quem fez, o que mudou e quando;
- leitor de código de barras pela câmera, com campo manual quando o aparelho não tem `BarcodeDetector`;
- instalável no celular (PWA) e abre offline.

## Onde ficam os dados

```
estoque/itens/{id}        nome, codigoBarras, ms, lote, validade, quantidade,
                          minimo, unidade, local, atualizadoEm, atualizadoPor
estoque/historico/{id}    itemId, nome, tipo, de, para, delta, quando, por
estoque/compras/{id}      itemId, nome, quantidade, comprado, criadoEm, por
farmacia/operadores       lista de nomes da equipe (compartilhada com o outro app)
```

O nó `farmacia/inventario` (o que vem do Digifarma) **não é lido nem escrito aqui**.

## Instalação

1. Console do Firebase > Configurações do projeto > Seus apps > Configuração do SDK.
2. Copie os valores para `CONFIG_FIREBASE`, no topo de `app.js`
   (`apiKey`, `messagingSenderId`, `appId`). Não são segredo — quem protege o
   banco são as regras, publicadas a partir do repositório FARMACIA-SNGPC.
3. Console do Firebase > Authentication > Sign-in method: habilite **E-mail/senha**
   e crie um usuário para cada pessoa que vai usar o app.
4. GitHub > Settings > Pages > Source: `main` / raiz.
5. Abra a URL no celular e use "Adicionar à tela de início".

## Decisões que valem lembrar

- **Validade MM/AA vale até o último dia do mês.** `fimDaValidade()` usa o dia 0
  do mês seguinte. Já houve um bug aqui que vencia o item ~30 dias antes.
- **Sem `prompt()` e `confirm()` nativos** — o PWA em modo standalone bloqueia.
  Tudo passa por `abrirModal()` / `confirmar()`.
- **`localStorage` só guarda o nome do operador escolhido naquele aparelho.**
  Nenhum dado de estoque mora no aparelho.
- **Toda movimentação grava `por`** com o nome de quem estava operando. Foi
  para isso que o app pergunta "quem está operando" na entrada.

## Teste antes de publicar

```
node teste-fumaca.js
```

Valida a sintaxe e roda as funções de validade e busca com DOM simulado.
