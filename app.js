/* ESTOQUE — balcão
   Cadastro manual, alertas, compras, contagem, histórico, scanner, PWA.
   Regras do projeto respeitadas aqui:
   - nada de prompt()/confirm() nativos: modais próprios;
   - localStorage só para preferência do aparelho (nunca dados);
   - toda movimentação grava o nome de quem operou;
   - validade MM/AA vale até o ÚLTIMO dia do mês.
*/
'use strict';

/* ============================================================
   1. CONFIGURAÇÃO
   ============================================================
   Troque pelos valores do Console do Firebase:
   Configurações do projeto > Seus apps > Configuração do SDK.
   Nada aqui é segredo — quem protege o banco são as regras
   (agente/regras-firebase.json no repositório FARMACIA-SNGPC).
*/
const CONFIG_FIREBASE = {
  apiKey: 'COLOQUE_A_API_KEY',
  authDomain: 'estoque-remedios-7b785.firebaseapp.com',
  databaseURL: 'https://estoque-remedios-7b785-default-rtdb.firebaseio.com',
  projectId: 'estoque-remedios-7b785',
  storageBucket: 'estoque-remedios-7b785.appspot.com',
  messagingSenderId: 'COLOQUE_O_SENDER_ID',
  appId: 'COLOQUE_O_APP_ID'
};

const DIAS_VENCENDO = 90;      // janela de "vencendo"
const CHAVE_OPERADOR = 'estoque.operador';   // preferência local do aparelho

firebase.initializeApp(CONFIG_FIREBASE);
const auth = firebase.auth();
const db = firebase.database();

/* ============================================================
   2. ESTADO
   ============================================================ */
const estado = {
  operador: null,
  itens: {},        // estoque/itens
  historico: {},    // estoque/historico
  compras: {},      // estoque/compras
  operadores: [],   // farmacia/operadores (compartilhado)
  vista: 'itens',
  filtroAlerta: 'tudo',
  busca: '',
  buscaContagem: '',
  contagem: null    // { contados: {id: qtd} }
};

/* ============================================================
   3. ATALHOS E UTILIDADES
   ============================================================ */
const $ = (id) => document.getElementById(id);
const criar = (tag, classe) => { const e = document.createElement(tag); if (classe) e.className = classe; return e; };
const esc = (s) => String(s ?? '');

function avisar(texto, ms = 2600) {
  const el = $('aviso');
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(avisar._t);
  avisar._t = setTimeout(() => { el.hidden = true; }, ms);
}

function agora() { return new Date().toISOString(); }

function dataCurta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/* --- validade MM/AA: vale até o ÚLTIMO dia do mês --- */
function fimDaValidade(mmaa) {
  const m = /^(\d{2})\/?(\d{2}|\d{4})$/.exec(String(mmaa || '').trim());
  if (!m) return null;
  const mes = parseInt(m[1], 10);
  if (mes < 1 || mes > 12) return null;
  let ano = parseInt(m[2], 10);
  if (ano < 100) ano += 2000;
  // dia 0 do mês seguinte = último dia do mês informado, 23:59:59
  return new Date(ano, mes, 0, 23, 59, 59, 999);
}

function diasAteVencer(mmaa) {
  const fim = fimDaValidade(mmaa);
  if (!fim) return null;
  const hoje = new Date();
  return Math.ceil((fim - hoje) / 86400000);
}

function situacao(item) {
  const d = diasAteVencer(item.validade);
  if (d !== null && d < 0) return 'vencido';
  if (d !== null && d <= DIAS_VENCENDO) return 'vencendo';
  const min = Number(item.minimo || 0);
  if (min > 0 && Number(item.quantidade || 0) <= min) return 'baixo';
  return 'ok';
}

const ROTULO_SITUACAO = {
  vencido: 'Vencido',
  vencendo: 'Vencendo',
  baixo: 'Estoque baixo',
  ok: 'Em dia'
};

function normalizar(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function combina(item, termo) {
  if (!termo) return true;
  const t = normalizar(termo);
  return [item.nome, item.codigoBarras, item.ms, item.lote, item.local]
    .some((c) => normalizar(c).includes(t));
}

function itensOrdenados() {
  return Object.entries(estado.itens)
    .map(([id, it]) => ({ id, ...it }))
    .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
}

/* ============================================================
   4. MODAIS PRÓPRIOS (o PWA bloqueia prompt/confirm)
   ============================================================ */
let fecharModalAtual = null;

function abrirModal({ titulo, corpo, acoes }) {
  const caixa = $('modal');
  $('modal-titulo').textContent = titulo;
  const alvo = $('modal-corpo');
  alvo.innerHTML = '';
  if (typeof corpo === 'string') alvo.innerHTML = corpo;
  else if (corpo) alvo.appendChild(corpo);

  const barra = $('modal-acoes');
  barra.innerHTML = '';
  (acoes || []).forEach((a) => {
    const b = criar('button', 'botao ' + (a.estilo || 'botao-fantasma'));
    b.textContent = a.texto;
    b.onclick = () => a.aoClicar?.();
    barra.appendChild(b);
  });

  caixa.hidden = false;
  fecharModalAtual = () => { caixa.hidden = true; fecharModalAtual = null; };
  const primeiro = alvo.querySelector('input, select, textarea');
  if (primeiro) setTimeout(() => primeiro.focus(), 60);
  return fecharModalAtual;
}

function fecharModal() { fecharModalAtual?.(); }

function confirmar(titulo, texto, textoOk = 'Confirmar', estilo = 'botao-perigo') {
  return new Promise((resolve) => {
    abrirModal({
      titulo,
      corpo: `<p class="sublinha">${esc(texto)}</p>`,
      acoes: [
        { texto: 'Cancelar', aoClicar: () => { fecharModal(); resolve(false); } },
        { texto: textoOk, estilo, aoClicar: () => { fecharModal(); resolve(true); } }
      ]
    });
  });
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharModal(); });
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') fecharModal(); });

/* ============================================================
   5. ENTRAR / SAIR
   ============================================================ */
$('btn-entrar').onclick = async () => {
  const email = $('login-email').value.trim();
  const senha = $('login-senha').value;
  const erro = $('login-erro');
  erro.hidden = true;
  if (!email || !senha) { erro.textContent = 'Preencha e-mail e senha.'; erro.hidden = false; return; }
  $('btn-entrar').disabled = true;
  try {
    await auth.signInWithEmailAndPassword(email, senha);
  } catch (e) {
    erro.textContent = mensagemDeErro(e);
    erro.hidden = false;
  } finally {
    $('btn-entrar').disabled = false;
  }
};

$('login-senha').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-entrar').click(); });

function mensagemDeErro(e) {
  const c = e?.code || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) {
    return 'E-mail ou senha não conferem.';
  }
  if (c.includes('network')) return 'Sem conexão com o Firebase. Verifique a internet.';
  if (c.includes('too-many-requests')) return 'Muitas tentativas. Espere um minuto e tente de novo.';
  return 'Não foi possível entrar: ' + (e?.message || c || 'erro desconhecido');
}

$('btn-sair').onclick = async () => {
  if (!(await confirmar('Sair do app', 'Você vai precisar entrar de novo com e-mail e senha.', 'Sair'))) return;
  desligarEscutas();
  await auth.signOut();
};

auth.onAuthStateChanged((user) => {
  if (user) {
    $('tela-login').hidden = true;
    ligarEscutas();
    escolherOperador();
  } else {
    desligarEscutas();
    $('app').hidden = true;
    $('tela-operador').hidden = true;
    $('tela-login').hidden = false;
    $('login-senha').value = '';
  }
});

/* ============================================================
   6. OPERADOR
   ============================================================ */
function escolherOperador() {
  const salvo = localStorage.getItem(CHAVE_OPERADOR); // preferência do aparelho
  if (salvo) { entrarNoApp(salvo); return; }
  mostrarTelaOperador();
}

function mostrarTelaOperador() {
  $('app').hidden = true;
  $('tela-operador').hidden = false;
  pintarOperadores();
}

function pintarOperadores() {
  const alvo = $('lista-operadores');
  alvo.innerHTML = '';
  estado.operadores.forEach((nome) => {
    const b = criar('button', 'chip');
    b.textContent = nome;
    b.onclick = () => entrarNoApp(nome);
    alvo.appendChild(b);
  });
}

$('btn-operador').onclick = async () => {
  const nome = $('operador-novo').value.trim();
  if (!nome) { avisar('Escolha um nome da lista ou digite um novo.'); return; }
  if (!estado.operadores.includes(nome)) {
    const lista = [...estado.operadores, nome].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    await db.ref('farmacia/operadores').set(lista);
  }
  entrarNoApp(nome);
};

function entrarNoApp(nome) {
  estado.operador = nome;
  localStorage.setItem(CHAVE_OPERADOR, nome);
  $('rotulo-operador').textContent = 'Operando: ' + nome;
  $('tela-operador').hidden = true;
  $('app').hidden = false;
  pintar();
}

$('btn-trocar-operador').onclick = () => {
  localStorage.removeItem(CHAVE_OPERADOR);
  estado.operador = null;
  $('operador-novo').value = '';
  mostrarTelaOperador();
};

/* ============================================================
   7. SINCRONIZAÇÃO
   ============================================================ */
const escutas = [];

function escutar(caminho, aoMudar) {
  const ref = db.ref(caminho);
  const cb = ref.on('value',
    (snap) => { aoMudar(snap.val() || {}); },
    (erro) => {
      $('barra-estado').textContent = 'Sem acesso a ' + caminho + ' — verifique as regras do Firebase e se o seu usuário está autorizado.';
      $('barra-estado').hidden = false;
      console.error(caminho, erro);
    });
  escutas.push({ ref, cb });
}

function ligarEscutas() {
  if (escutas.length) return;
  escutar('estoque/itens', (v) => { estado.itens = v; pintar(); });
  escutar('estoque/historico', (v) => { estado.historico = v; if (estado.vista === 'historico') pintarHistorico(); });
  escutar('estoque/compras', (v) => { estado.compras = v; pintarCompras(); pintarSelos(); });
  escutar('farmacia/operadores', (v) => {
    estado.operadores = Array.isArray(v) ? v : Object.values(v || {});
    pintarOperadores();
  });
}

function desligarEscutas() {
  escutas.forEach(({ ref, cb }) => ref.off('value', cb));
  escutas.length = 0;
}

/* --- gravação com rastreabilidade --- */
async function registrar(item, tipo, de, para, observacao) {
  const evento = {
    itemId: item.id,
    nome: item.nome,
    tipo,                       // cadastro | ajuste | contagem | baixa | entrada | remocao
    de: de ?? null,
    para: para ?? null,
    delta: (de === null || de === undefined) ? null : Number(para) - Number(de),
    observacao: observacao || null,
    quando: agora(),
    por: estado.operador
  };
  await db.ref('estoque/historico').push(evento);
}

async function salvarItem(id, dados, tipo, quantidadeAnterior) {
  const completo = { ...dados, atualizadoEm: agora(), atualizadoPor: estado.operador };
  if (id) {
    await db.ref('estoque/itens/' + id).update(completo);
    await registrar({ id, nome: completo.nome }, tipo, quantidadeAnterior ?? null, completo.quantidade ?? null);
    return id;
  }
  const ref = await db.ref('estoque/itens').push({ ...completo, criadoEm: agora(), criadoPor: estado.operador });
  await registrar({ id: ref.key, nome: completo.nome }, 'cadastro', null, completo.quantidade ?? null);
  return ref.key;
}

/* ============================================================
   8. NAVEGAÇÃO
   ============================================================ */
document.querySelectorAll('.nav-item').forEach((b) => {
  b.onclick = () => {
    estado.vista = b.dataset.vista;
    document.querySelectorAll('.nav-item').forEach((x) => x.classList.toggle('nav-ativo', x === b));
    document.querySelectorAll('.vista').forEach((v) => { v.hidden = v.id !== 'v-' + estado.vista; });
    pintar();
  };
});

$('busca').oninput = (e) => { estado.busca = e.target.value; pintarItens(); };
$('contagem-busca').oninput = (e) => { estado.buscaContagem = e.target.value; pintarContagem(); };

document.querySelectorAll('[data-alerta]').forEach((b) => {
  b.onclick = () => {
    estado.filtroAlerta = b.dataset.alerta;
    document.querySelectorAll('[data-alerta]').forEach((x) => x.classList.toggle('chip-ativo', x === b));
    pintarAlertas();
  };
});

/* ============================================================
   9. DESENHO DA TELA
   ============================================================ */
function pintar() {
  if (!estado.operador) return;
  pintarSelos();
  if (estado.vista === 'itens') pintarItens();
  if (estado.vista === 'alertas') pintarAlertas();
  if (estado.vista === 'compras') pintarCompras();
  if (estado.vista === 'contagem') pintarContagem();
  if (estado.vista === 'historico') pintarHistorico();
}

function etiqueta(item, aoClicar) {
  const s = situacao(item);
  const el = criar('button', 'etiqueta etiqueta-' + s);
  const dias = diasAteVencer(item.validade);

  const nome = criar('p', 'etiqueta-nome');
  nome.textContent = item.nome || '(sem nome)';
  el.appendChild(nome);

  const meta = criar('p', 'etiqueta-meta');
  const partes = [];
  if (item.codigoBarras) partes.push('EAN ' + item.codigoBarras);
  if (item.ms) partes.push('M.S. ' + item.ms);
  if (item.lote) partes.push('Lote ' + item.lote);
  if (item.validade) partes.push('Val. ' + item.validade + (dias !== null ? ` (${dias < 0 ? 'vencido há ' + Math.abs(dias) : dias} dia${Math.abs(dias) === 1 ? '' : 's'}${dias < 0 ? '' : ' restantes'})` : ''));
  if (item.local) partes.push(item.local);
  partes.forEach((p) => { const s2 = criar('span'); s2.textContent = p; meta.appendChild(s2); });
  el.appendChild(meta);

  const base = criar('div', 'etiqueta-base');
  const q = criar('div');
  q.innerHTML = `<span class="quantidade">${Number(item.quantidade || 0)}</span><span class="unidade">${esc(item.unidade || 'un')}${item.minimo ? ' · mín. ' + item.minimo : ''}</span>`;
  base.appendChild(q);
  const tag = criar('span', 'tag tag-' + s);
  tag.textContent = ROTULO_SITUACAO[s];
  base.appendChild(tag);
  el.appendChild(base);

  el.onclick = () => aoClicar(item);
  return el;
}

function pintarItens() {
  const alvo = $('itens');
  alvo.innerHTML = '';
  const lista = itensOrdenados().filter((i) => combina(i, estado.busca));
  $('itens-vazio').hidden = lista.length > 0 || Object.keys(estado.itens).length > 0;
  if (!lista.length && Object.keys(estado.itens).length) {
    const p = criar('p', 'vazio');
    p.textContent = 'Nada encontrado para “' + estado.busca + '”.';
    alvo.appendChild(p);
    return;
  }
  lista.forEach((i) => alvo.appendChild(etiqueta(i, abrirFicha)));
}

function pintarAlertas() {
  const alvo = $('alertas');
  alvo.innerHTML = '';
  let lista = itensOrdenados().map((i) => ({ ...i, s: situacao(i) })).filter((i) => i.s !== 'ok');
  if (estado.filtroAlerta !== 'tudo') lista = lista.filter((i) => i.s === estado.filtroAlerta);
  const ordem = { vencido: 0, vencendo: 1, baixo: 2 };
  lista.sort((a, b) => (ordem[a.s] - ordem[b.s]) || (diasAteVencer(a.validade) ?? 1e9) - (diasAteVencer(b.validade) ?? 1e9));
  $('alertas-vazio').hidden = lista.length > 0;
  lista.forEach((i) => alvo.appendChild(etiqueta(i, abrirFicha)));
}

function pintarSelos() {
  const alertas = itensOrdenados().filter((i) => situacao(i) !== 'ok').length;
  const compras = Object.values(estado.compras).filter((c) => !c.comprado).length;
  const sa = $('selo-alertas'); sa.textContent = alertas; sa.hidden = alertas === 0;
  const sc = $('selo-compras'); sc.textContent = compras; sc.hidden = compras === 0;
}

/* ============================================================
   10. FICHA DO ITEM
   ============================================================ */
function formularioItem(item) {
  const f = criar('div');
  f.innerHTML = `
    <label class="campo"><span>Nome</span><input id="f-nome" type="text" value="${esc(item.nome || '')}"></label>
    <div class="dupla">
      <label class="campo"><span>Código de barras</span><input id="f-ean" type="text" inputmode="numeric" value="${esc(item.codigoBarras || '')}"></label>
      <label class="campo"><span>Registro M.S.</span><input id="f-ms" type="text" inputmode="numeric" value="${esc(item.ms || '')}"></label>
    </div>
    <div class="dupla">
      <label class="campo"><span>Lote</span><input id="f-lote" type="text" value="${esc(item.lote || '')}"></label>
      <label class="campo"><span>Validade (MM/AA)</span><input id="f-validade" type="text" inputmode="numeric" placeholder="09/27" maxlength="5" value="${esc(item.validade || '')}"></label>
    </div>
    <div class="dupla">
      <label class="campo"><span>Quantidade</span><input id="f-qtd" type="number" inputmode="numeric" min="0" value="${Number(item.quantidade || 0)}"></label>
      <label class="campo"><span>Estoque mínimo</span><input id="f-min" type="number" inputmode="numeric" min="0" value="${Number(item.minimo || 0)}"></label>
    </div>
    <div class="dupla">
      <label class="campo"><span>Unidade</span><input id="f-un" type="text" value="${esc(item.unidade || 'un')}"></label>
      <label class="campo"><span>Local na loja</span><input id="f-local" type="text" value="${esc(item.local || '')}"></label>
    </div>
    <p id="f-erro" class="aviso-erro" hidden></p>
  `;
  return f;
}

function lerFormulario() {
  const validade = $('f-validade').value.trim();
  const erro = $('f-erro');
  erro.hidden = true;
  const nome = $('f-nome').value.trim();
  if (!nome) { erro.textContent = 'O item precisa de um nome.'; erro.hidden = false; return null; }
  if (validade && !fimDaValidade(validade)) {
    erro.textContent = 'Validade em formato MM/AA — por exemplo 09/27.';
    erro.hidden = false;
    return null;
  }
  return {
    nome,
    codigoBarras: $('f-ean').value.trim(),
    ms: $('f-ms').value.trim(),
    lote: $('f-lote').value.trim(),
    validade,
    quantidade: Number($('f-qtd').value || 0),
    minimo: Number($('f-min').value || 0),
    unidade: $('f-un').value.trim() || 'un',
    local: $('f-local').value.trim()
  };
}

function abrirNovoItem(codigoBarras) {
  abrirModal({
    titulo: 'Novo item',
    corpo: formularioItem({ codigoBarras: codigoBarras || '' }),
    acoes: [
      { texto: 'Cancelar', aoClicar: fecharModal },
      {
        texto: 'Salvar item', estilo: 'botao-principal', aoClicar: async () => {
          const dados = lerFormulario();
          if (!dados) return;
          await salvarItem(null, dados, 'cadastro');
          fecharModal();
          avisar('Item cadastrado.');
        }
      }
    ]
  });
}

function abrirFicha(item) {
  const corpo = criar('div');
  const resumo = criar('div');
  resumo.innerHTML = `
    <p class="sublinha">${esc(item.local || 'Sem local definido')} · ${Number(item.quantidade || 0)} ${esc(item.unidade || 'un')}
    · atualizado ${dataCurta(item.atualizadoEm)} por ${esc(item.atualizadoPor || '—')}</p>
    <div class="contagem-entrada">
      <button class="botao botao-secundario" id="ficha-menos">−1</button>
      <input id="ficha-qtd" type="number" inputmode="numeric" value="${Number(item.quantidade || 0)}">
      <button class="botao botao-secundario" id="ficha-mais">+1</button>
      <button class="botao botao-principal" id="ficha-gravar">Gravar quantidade</button>
    </div>
  `;
  corpo.appendChild(resumo);

  abrirModal({
    titulo: item.nome || '(sem nome)',
    corpo,
    acoes: [
      { texto: 'Editar cadastro', aoClicar: () => abrirEdicao(item) },
      {
        texto: 'Comprar', aoClicar: async () => {
          await db.ref('estoque/compras').push({
            itemId: item.id, nome: item.nome, quantidade: Math.max(1, Number(item.minimo || 1)),
            comprado: false, criadoEm: agora(), por: estado.operador
          });
          fecharModal();
          avisar('Enviado para a lista de compras.');
        }
      },
      { texto: 'Fechar', aoClicar: fecharModal }
    ]
  });

  const campo = $('ficha-qtd');
  $('ficha-menos').onclick = () => { campo.value = Math.max(0, Number(campo.value || 0) - 1); };
  $('ficha-mais').onclick = () => { campo.value = Number(campo.value || 0) + 1; };
  $('ficha-gravar').onclick = async () => {
    const nova = Number(campo.value || 0);
    const antiga = Number(item.quantidade || 0);
    if (nova === antiga) { fecharModal(); return; }
    await db.ref('estoque/itens/' + item.id).update({ quantidade: nova, atualizadoEm: agora(), atualizadoPor: estado.operador });
    await registrar(item, 'ajuste', antiga, nova);
    fecharModal();
    avisar('Quantidade gravada.');
  };
}

function abrirEdicao(item) {
  abrirModal({
    titulo: 'Editar ' + (item.nome || 'item'),
    corpo: formularioItem(item),
    acoes: [
      {
        texto: 'Remover', estilo: 'botao-perigo', aoClicar: async () => {
          fecharModal();
          if (!(await confirmar('Remover item', `“${item.nome}” sai do estoque. O histórico continua guardado.`, 'Remover'))) return;
          await db.ref('estoque/itens/' + item.id).remove();
          await registrar(item, 'remocao', Number(item.quantidade || 0), 0);
          avisar('Item removido.');
        }
      },
      { texto: 'Cancelar', aoClicar: fecharModal },
      {
        texto: 'Salvar', estilo: 'botao-principal', aoClicar: async () => {
          const dados = lerFormulario();
          if (!dados) return;
          await salvarItem(item.id, dados, 'ajuste', Number(item.quantidade || 0));
          fecharModal();
          avisar('Item atualizado.');
        }
      }
    ]
  });
}

$('btn-novo-item').onclick = () => abrirNovoItem('');

/* ============================================================
   11. COMPRAS
   ============================================================ */
function pintarCompras() {
  const alvo = $('compras');
  if (!alvo) return;
  alvo.innerHTML = '';
  const lista = Object.entries(estado.compras)
    .map(([id, c]) => ({ id, ...c }))
    .sort((a, b) => Number(a.comprado) - Number(b.comprado) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  $('compras-vazio').hidden = lista.length > 0;

  lista.forEach((c) => {
    const linha = criar('div', 'item-compra' + (c.comprado ? ' comprado' : ''));

    const marca = criar('input');
    marca.type = 'checkbox';
    marca.checked = !!c.comprado;
    marca.setAttribute('aria-label', 'Marcar ' + c.nome + ' como comprado');
    marca.onchange = () => db.ref('estoque/compras/' + c.id).update({
      comprado: marca.checked, compradoPor: marca.checked ? estado.operador : null, compradoEm: marca.checked ? agora() : null
    });
    linha.appendChild(marca);

    const nome = criar('span', 'item-compra-nome');
    nome.textContent = c.nome + ' · ' + Number(c.quantidade || 1);
    linha.appendChild(nome);

    const tirar = criar('button', 'botao botao-fantasma');
    tirar.textContent = 'Tirar';
    tirar.onclick = () => db.ref('estoque/compras/' + c.id).remove();
    linha.appendChild(tirar);

    alvo.appendChild(linha);
  });
}

$('btn-gerar-compras').onclick = async () => {
  const faltando = itensOrdenados().filter((i) => {
    const min = Number(i.minimo || 0);
    return min > 0 && Number(i.quantidade || 0) <= min;
  });
  if (!faltando.length) { avisar('Nenhum item abaixo do mínimo.'); return; }
  const jaNaLista = new Set(Object.values(estado.compras).filter((c) => !c.comprado).map((c) => c.itemId));
  const novos = faltando.filter((i) => !jaNaLista.has(i.id));
  if (!novos.length) { avisar('Todos os itens em falta já estão na lista.'); return; }
  const atualizacao = {};
  novos.forEach((i) => {
    const chave = db.ref('estoque/compras').push().key;
    atualizacao[chave] = {
      itemId: i.id, nome: i.nome,
      quantidade: Math.max(1, Number(i.minimo || 1) * 2 - Number(i.quantidade || 0)),
      comprado: false, criadoEm: agora(), por: estado.operador
    };
  });
  await db.ref('estoque/compras').update(atualizacao);
  avisar(novos.length + ' item(ns) na lista de compras.');
};

/* ============================================================
   12. MODO CONTAGEM
   ============================================================ */
$('btn-contagem-iniciar').onclick = () => {
  estado.contagem = { contados: {}, iniciadaEm: agora() };
  $('contagem-inicio').hidden = true;
  $('contagem-corpo').hidden = false;
  $('btn-contagem-encerrar').hidden = false;
  pintarContagem();
};

$('btn-contagem-encerrar').onclick = async () => {
  const diferencas = diferencasDaContagem();
  if (!diferencas.length) {
    if (!(await confirmar('Encerrar contagem', 'Nenhuma diferença encontrada. Encerrar mesmo assim?', 'Encerrar', 'botao-principal'))) return;
    encerrarContagem();
    avisar('Contagem encerrada sem diferenças.');
    return;
  }
  const texto = diferencas.slice(0, 8).map((d) => `${d.nome}: ${d.de} → ${d.para}`).join('; ')
    + (diferencas.length > 8 ? ` e mais ${diferencas.length - 8}` : '');
  if (!(await confirmar('Aplicar contagem', `${diferencas.length} item(ns) mudam de quantidade. ${texto}. Tudo fica no histórico com o seu nome.`, 'Aplicar', 'botao-principal'))) return;

  for (const d of diferencas) {
    await db.ref('estoque/itens/' + d.id).update({ quantidade: d.para, atualizadoEm: agora(), atualizadoPor: estado.operador });
    await registrar({ id: d.id, nome: d.nome }, 'contagem', d.de, d.para);
  }
  encerrarContagem();
  avisar(diferencas.length + ' ajuste(s) aplicado(s).');
};

function encerrarContagem() {
  estado.contagem = null;
  $('contagem-inicio').hidden = false;
  $('contagem-corpo').hidden = true;
  $('btn-contagem-encerrar').hidden = true;
}

function diferencasDaContagem() {
  if (!estado.contagem) return [];
  return Object.entries(estado.contagem.contados)
    .map(([id, qtd]) => {
      const it = estado.itens[id];
      if (!it) return null;
      const de = Number(it.quantidade || 0);
      const para = Number(qtd);
      return de === para ? null : { id, nome: it.nome, de, para };
    })
    .filter(Boolean);
}

function pintarContagem() {
  if (!estado.contagem) return;
  const todos = itensOrdenados();
  const contados = Object.keys(estado.contagem.contados).length;
  $('contagem-contados').textContent = contados;
  $('contagem-difere').textContent = diferencasDaContagem().length;
  $('contagem-faltam').textContent = todos.length - contados;

  const alvo = $('contagem-itens');
  alvo.innerHTML = '';
  todos.filter((i) => combina(i, estado.buscaContagem)).forEach((item) => {
    const cartao = criar('div', 'etiqueta');
    const nome = criar('p', 'etiqueta-nome');
    nome.textContent = item.nome;
    cartao.appendChild(nome);

    const meta = criar('p', 'etiqueta-meta');
    const info = criar('span');
    info.textContent = `Sistema: ${Number(item.quantidade || 0)} ${item.unidade || 'un'}${item.local ? ' · ' + item.local : ''}`;
    meta.appendChild(info);
    cartao.appendChild(meta);

    const linha = criar('div', 'contagem-entrada');
    const campo = criar('input');
    campo.type = 'number';
    campo.inputMode = 'numeric';
    campo.min = '0';
    campo.setAttribute('aria-label', 'Contagem de ' + item.nome);
    if (estado.contagem.contados[item.id] !== undefined) campo.value = estado.contagem.contados[item.id];
    campo.oninput = () => {
      if (campo.value === '') delete estado.contagem.contados[item.id];
      else estado.contagem.contados[item.id] = Number(campo.value);
      atualizarPlacar(cartao, item);
    };
    linha.appendChild(campo);

    const marcaOk = criar('button', 'botao botao-secundario');
    marcaOk.textContent = 'Confere';
    marcaOk.onclick = () => {
      campo.value = Number(item.quantidade || 0);
      estado.contagem.contados[item.id] = Number(item.quantidade || 0);
      atualizarPlacar(cartao, item);
    };
    linha.appendChild(marcaOk);
    cartao.appendChild(linha);
    alvo.appendChild(cartao);
    atualizarPlacar(cartao, item);
  });
}

function atualizarPlacar(cartao, item) {
  const contado = estado.contagem?.contados[item.id];
  let nota = cartao.querySelector('.difere');
  if (contado === undefined || Number(contado) === Number(item.quantidade || 0)) {
    nota?.remove();
  } else {
    if (!nota) { nota = criar('p', 'difere'); cartao.appendChild(nota); }
    const d = Number(contado) - Number(item.quantidade || 0);
    nota.textContent = `Diferença de ${d > 0 ? '+' : ''}${d}`;
  }
  $('contagem-contados').textContent = Object.keys(estado.contagem.contados).length;
  $('contagem-difere').textContent = diferencasDaContagem().length;
  $('contagem-faltam').textContent = Object.keys(estado.itens).length - Object.keys(estado.contagem.contados).length;
}

/* ============================================================
   13. HISTÓRICO
   ============================================================ */
const ROTULO_TIPO = {
  cadastro: 'Cadastro', ajuste: 'Ajuste', contagem: 'Contagem',
  baixa: 'Baixa', entrada: 'Entrada', remocao: 'Remoção'
};

function pintarHistorico() {
  const alvo = $('historico');
  alvo.innerHTML = '';
  const lista = Object.entries(estado.historico)
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => String(b.quando).localeCompare(String(a.quando)))
    .slice(0, 300);
  $('historico-vazio').hidden = lista.length > 0;

  lista.forEach((e) => {
    const el = criar('div', 'evento');
    const topo = criar('div', 'evento-topo');
    const t = criar('strong');
    t.textContent = e.nome || '(item removido)';
    topo.appendChild(t);
    const q = criar('span', 'evento-quando');
    q.textContent = dataCurta(e.quando);
    topo.appendChild(q);
    el.appendChild(topo);

    const linha = criar('div', 'evento-topo');
    const desc = criar('span');
    const mudanca = (e.de === null || e.de === undefined) ? '' : ` ${e.de} → ${e.para}`;
    desc.textContent = `${ROTULO_TIPO[e.tipo] || e.tipo}${mudanca} · ${e.por || '—'}`;
    linha.appendChild(desc);
    if (e.delta !== null && e.delta !== undefined && e.delta !== 0) {
      const d = criar('span', 'evento-delta ' + (e.delta > 0 ? 'delta-mais' : 'delta-menos'));
      d.textContent = (e.delta > 0 ? '+' : '') + e.delta;
      linha.appendChild(d);
    }
    el.appendChild(linha);
    alvo.appendChild(el);
  });
}

/* ============================================================
   14. SCANNER DE CÓDIGO DE BARRAS
   ============================================================ */
let leitura = { stream: null, parar: false, destino: null };

async function abrirScanner(destino) {
  leitura.destino = destino;
  leitura.parar = false;
  $('scanner').hidden = false;
  $('scanner-manual').value = '';
  const aviso = $('scanner-aviso');

  if (!('BarcodeDetector' in window)) {
    aviso.textContent = 'Este aparelho não tem leitor de código no navegador. Digite o código abaixo.';
    $('scanner-manual').focus();
    return;
  }
  try {
    const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e', 'itf'] });
    leitura.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = $('scanner-video');
    video.srcObject = leitura.stream;
    await video.play();
    aviso.textContent = 'Aponte para o código de barras da caixa.';
    const passo = async () => {
      if (leitura.parar) return;
      try {
        const achados = await detector.detect(video);
        if (achados.length) { usarCodigo(achados[0].rawValue); return; }
      } catch (_) { /* frame ruim, segue */ }
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  } catch (e) {
    aviso.textContent = 'Câmera indisponível (' + (e.name || 'erro') + '). Digite o código abaixo.';
    $('scanner-manual').focus();
  }
}

function fecharScanner() {
  leitura.parar = true;
  leitura.stream?.getTracks().forEach((t) => t.stop());
  leitura.stream = null;
  $('scanner-video').srcObject = null;
  $('scanner').hidden = true;
}

function usarCodigo(codigo) {
  const limpo = String(codigo || '').trim();
  fecharScanner();
  if (!limpo) return;
  const achado = itensOrdenados().find((i) => String(i.codigoBarras || '') === limpo);
  if (leitura.destino === 'contagem') {
    if (!achado) { avisar('Código ' + limpo + ' não está cadastrado.'); return; }
    estado.buscaContagem = achado.nome;
    $('contagem-busca').value = achado.nome;
    pintarContagem();
    return;
  }
  if (achado) { abrirFicha(achado); return; }
  abrirNovoItem(limpo);
  avisar('Código novo — preencha o cadastro.');
}

$('btn-escanear').onclick = () => abrirScanner('itens');
$('btn-contagem-escanear').onclick = () => abrirScanner('contagem');
$('scanner-fechar').onclick = fecharScanner;
$('scanner-usar').onclick = () => usarCodigo($('scanner-manual').value);
$('scanner-manual').addEventListener('keydown', (e) => { if (e.key === 'Enter') usarCodigo(e.target.value); });

/* ============================================================
   15. PWA
   ============================================================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker não registrado:', e));
  });
}

window.addEventListener('offline', () => {
  $('barra-estado').textContent = 'Sem internet — o que você mudar agora sobe quando a conexão voltar.';
  $('barra-estado').hidden = false;
});
window.addEventListener('online', () => { $('barra-estado').hidden = true; });

/* exposto para o teste de fumaça */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fimDaValidade, diasAteVencer, situacao, normalizar, combina };
}
