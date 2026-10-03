'use strict';

/** Жанр задаёт единый рисунок и палитру для PDF, EPUB и образца в интерфейсе. */
const GENRES = [
  { id: 'fantasy', name: 'Фэнтези', accent: '#A46B28', systemBg: '#F8F4EB', systemBorder: '#DCCBA9', coverBg: '#252017', description: 'Звёзды и растительные виньетки', panel: 'rounded' },
  { id: 'dark-fantasy', name: 'Тёмное фэнтези', accent: '#711D29', systemBg: '#F7EFF0', systemBorder: '#CCADB2', coverBg: '#21191E', description: 'Готические арки и гранёные узоры', panel: 'angular' },
  { id: 'horror', name: 'Мистика и ужасы', accent: '#37334E', systemBg: '#F2F1F7', systemBorder: '#C1BCD2', coverBg: '#181823', description: 'Полумесяц и тонкие ветви', panel: 'rounded' },
  { id: 'sci-fi', name: 'Научная фантастика', accent: '#326579', systemBg: '#EDF5F8', systemBorder: '#AACAD6', coverBg: '#15232C', description: 'Орбиты и точная геометрия', panel: 'angular' },
  { id: 'litrpg', name: 'ЛитРПГ', accent: '#376547', systemBg: '#EFF6EF', systemBorder: '#B3CDB8', coverBg: '#18261F', description: 'Кристаллы и рамки системных окон', panel: 'angular' },
  { id: 'romance', name: 'Романтика', accent: '#B95C59', systemBg: '#FCF0F2', systemBorder: '#E4BEC7', coverBg: '#35212A', description: 'Цветы и переплетённые стебли', panel: 'rounded' },
  { id: 'historical', name: 'Исторический', accent: '#9D742F', systemBg: '#F8F3EA', systemBorder: '#D7C4A5', coverBg: '#292219', description: 'Классическая пальметта и завитки', panel: 'classic' },
  { id: 'thriller', name: 'Детектив и триллер', accent: '#8E2733', systemBg: '#F4F1F2', systemBorder: '#C7BABE', coverBg: '#201C22', description: 'Строгие линии и острый геометрический знак', panel: 'angular' },
  { id: 'cultivation', name: 'Боевые искусства / культивация', accent: '#52715F', systemBg: '#F0F5EF', systemBorder: '#BECDBD', coverBg: '#1D2822', description: 'Облачные завитки и нефритовый круг', panel: 'rounded' },
  { id: 'regression', name: 'Регрессия / временные циклы', accent: '#615584', systemBg: '#F3F0F8', systemBorder: '#C9BEDD', coverBg: '#211E30', description: 'Переплетённые кольца и разомкнутые дуги', panel: 'classic' },
];

function genreProfile(id) {
  return GENRES.find(g => g.id === id) || GENRES[0];
}

module.exports = { GENRES, genreProfile };
