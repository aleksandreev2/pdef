'use strict';

/** Жанр задаёт единый рисунок и палитру для PDF, EPUB и образца в интерфейсе. */
const GENRES = [
  { id: 'fantasy', name: 'Фэнтези', accent: '#92703C', systemBg: '#F8F4EB', systemBorder: '#DCCBA9', coverBg: '#252017', description: 'Звёзды и растительные виньетки', panel: 'rounded' },
  { id: 'dark-fantasy', name: 'Тёмное фэнтези', accent: '#793E46', systemBg: '#F7EFF0', systemBorder: '#CCADB2', coverBg: '#21191E', description: 'Готические арки и гранёные узоры', panel: 'angular' },
  { id: 'horror', name: 'Мистика и ужасы', accent: '#575373', systemBg: '#F2F1F7', systemBorder: '#C1BCD2', coverBg: '#181823', description: 'Полумесяц и тонкие ветви', panel: 'rounded' },
  { id: 'sci-fi', name: 'Научная фантастика', accent: '#326579', systemBg: '#EDF5F8', systemBorder: '#AACAD6', coverBg: '#15232C', description: 'Орбиты и точная геометрия', panel: 'angular' },
  { id: 'litrpg', name: 'ЛитРПГ', accent: '#376547', systemBg: '#EFF6EF', systemBorder: '#B3CDB8', coverBg: '#18261F', description: 'Кристаллы и рамки системных окон', panel: 'angular' },
  { id: 'romance', name: 'Романтика', accent: '#A15868', systemBg: '#FCF0F2', systemBorder: '#E4BEC7', coverBg: '#35212A', description: 'Цветы и переплетённые стебли', panel: 'rounded' },
  { id: 'historical', name: 'Исторический', accent: '#8B693E', systemBg: '#F8F3EA', systemBorder: '#D7C4A5', coverBg: '#292219', description: 'Классическая пальметта и завитки', panel: 'classic' },
  { id: 'thriller', name: 'Детектив и триллер', accent: '#6F3843', systemBg: '#F4F1F2', systemBorder: '#C7BABE', coverBg: '#201C22', description: 'Строгие линии и острый геометрический знак', panel: 'angular' },
  { id: 'cultivation', name: 'Боевые искусства / культивация', accent: '#52715F', systemBg: '#F0F5EF', systemBorder: '#BECDBD', coverBg: '#1D2822', description: 'Облачные завитки и нефритовый круг', panel: 'rounded' },
  { id: 'regression', name: 'Регрессия / временные циклы', accent: '#615584', systemBg: '#F3F0F8', systemBorder: '#C9BEDD', coverBg: '#211E30', description: 'Переплетённые кольца и разомкнутые дуги', panel: 'classic' },
];

function genreProfile(id) {
  return GENRES.find(g => g.id === id) || GENRES[0];
}

module.exports = { GENRES, genreProfile };
