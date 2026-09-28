// Truco.Rules — dados e funções puras do Truco Paulista (manilha nova, baralho limpo ou sujo).
// Fonte da verdade: docs/RULES.md §2, §4 e §5. A carta encoberta (força −1) é tratada no motor.
(function (root) {
  'use strict';
  const Truco = (root.Truco = root.Truco || {});

  // Força crescente das cartas comuns e sequência circular da manilha, por baralho (§4.3, §5.1).
  const DECKS = Object.freeze({
    limpo: Object.freeze(['Q', 'J', 'K', 'A', '2', '3']),
    sujo: Object.freeze(['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3']),
  });

  const ALL_RANKS = Object.freeze(['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3']);

  // Força crescente das manilhas: ouros < espadas < copas < paus (§4.4).
  const SUITS = Object.freeze(['diamonds', 'spades', 'hearts', 'clubs']);

  const SUIT_INFO = Object.freeze({
    clubs: Object.freeze({ name: 'Paus', symbol: '♣', color: 'black', letter: 'c' }),
    hearts: Object.freeze({ name: 'Copas', symbol: '♥', color: 'red', letter: 'h' }),
    spades: Object.freeze({ name: 'Espadas', symbol: '♠', color: 'black', letter: 's' }),
    diamonds: Object.freeze({ name: 'Ouros', symbol: '♦', color: 'red', letter: 'd' }),
  });

  const SUIT_BY_LETTER = Object.freeze({ c: 'clubs', h: 'hearts', s: 'spades', d: 'diamonds' });

  const RANK_NAMES = Object.freeze({
    '4': 'Quatro', '5': 'Cinco', '6': 'Seis', '7': 'Sete',
    Q: 'Dama', J: 'Valete', K: 'Rei', A: 'Ás', '2': 'Dois', '3': 'Três',
  });

  const MANILHA_NAMES = Object.freeze({
    clubs: 'Zap', hearts: 'Copas', spades: 'Espadilha', diamonds: 'Pica-fumo',
  });

  const VALUES = Object.freeze([1, 3, 6, 9, 12]);
  const CALL_NAMES = Object.freeze({ 3: 'Truco', 6: 'Seis', 9: 'Nove', 12: 'Doze' });
  const NEXT_VALUE = Object.freeze({ 1: 3, 3: 6, 6: 9, 9: 12 });

  function deckOrder(deck) {
    const name = deck === undefined ? 'limpo' : deck;
    const order = DECKS[name];
    if (!order) throw new Error(`Baralho desconhecido: ${String(deck)}`);
    return order;
  }

  function toCard(cardOrId) {
    return typeof cardOrId === 'string' ? cardFromId(cardOrId) : cardOrId;
  }

  function makeCard(rank, suit) {
    return { id: rank + SUIT_INFO[suit].letter, rank, suit };
  }

  /** Baralho completo em ordem fixa (posto crescente, depois naipe em SUITS). */
  function makeDeck(deck = 'limpo') {
    const cards = [];
    for (const rank of deckOrder(deck)) {
      for (const suit of SUITS) cards.push(makeCard(rank, suit));
    }
    return cards;
  }

  function isValidId(id) {
    if (typeof id !== 'string' || id.length !== 2) return false;
    return ALL_RANKS.includes(id[0]) && Object.prototype.hasOwnProperty.call(SUIT_BY_LETTER, id[1]);
  }

  function cardFromId(id) {
    if (!isValidId(id)) throw new Error(`Id de carta inválido: ${String(id)}`);
    return makeCard(id[0], SUIT_BY_LETTER[id[1]]);
  }

  /** Posto seguinte ao da vira na sequência circular do baralho (limpo: vira 3 → Q; sujo: vira 3 → 4). */
  function manilhaRankFor(viraRank, deck = 'limpo') {
    const order = deckOrder(deck);
    const i = order.indexOf(viraRank);
    if (i < 0) throw new Error(`Posto ${String(viraRank)} não existe no baralho ${deck}`);
    return order[(i + 1) % order.length];
  }

  function isManilha(card, manilhaRank) {
    return toCard(card).rank === manilhaRank;
  }

  /** Comuns: índice em DECKS[deck]; manilhas: 100 + índice do naipe em SUITS (100..103). */
  function strength(card, manilhaRank, deck = 'limpo') {
    const c = toCard(card);
    const order = deckOrder(deck);
    if (c.rank === manilhaRank) return 100 + SUITS.indexOf(c.suit);
    const i = order.indexOf(c.rank);
    if (i < 0) throw new Error(`Carta ${c.id} não pertence ao baralho ${deck}`);
    return i;
  }

  /** -1 | 0 | 1. Comuns do mesmo posto empatam (o naipe só desempata manilhas). */
  function compare(a, b, manilhaRank, deck = 'limpo') {
    const d = strength(a, manilhaRank, deck) - strength(b, manilhaRank, deck);
    return d > 0 ? 1 : d < 0 ? -1 : 0;
  }

  function nextValue(value) {
    return NEXT_VALUE[value] || null;
  }

  function label(card) {
    const c = toCard(card);
    return c.rank + SUIT_INFO[c.suit].symbol;
  }

  function fullName(card, manilhaRank) {
    const c = toCard(card);
    const base = `${RANK_NAMES[c.rank]} de ${SUIT_INFO[c.suit].name}`;
    if (manilhaRank && c.rank === manilhaRank) return `${MANILHA_NAMES[c.suit]} (${base})`;
    return base;
  }

  const Rules = {
    DECKS,
    ALL_RANKS,
    SUITS,
    SUIT_INFO,
    RANK_NAMES,
    MANILHA_NAMES,
    VALUES,
    CALL_NAMES,
    makeDeck,
    cardFromId,
    isValidId,
    manilhaRankFor,
    isManilha,
    strength,
    compare,
    nextValue,
    label,
    fullName,
  };

  Truco.Rules = Rules;
  if (typeof module === 'object' && module.exports) module.exports = Rules;
})(typeof window !== 'undefined' ? window : globalThis);
