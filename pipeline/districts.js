// מיפוי עיר → מחוז (לפי מחוזות הלמ"ס, יו"ש מסווג כרשימה נפרדת)
// normalize מסיר גרשיים, מקפים ותחיליות נפוצות כדי לתפוס וריאציות איות.
const DISTRICTS = [
  { id: 'north', he: 'הצפון' },
  { id: 'haifa', he: 'חיפה' },
  { id: 'center', he: 'המרכז' },
  { id: 'telaviv', he: 'תל אביב' },
  { id: 'jerusalem', he: 'ירושלים' },
  { id: 'south', he: 'הדרום' },
  { id: 'yosh', he: 'יהודה ושומרון' },
];

const CITY_TO_DISTRICT = {
  // צפון
  'צפת': 'north', 'טבריה': 'north', 'קרית שמונה': 'north', 'קריית שמונה': 'north', 'כרמיאל': 'north',
  'עכו': 'north', 'נהריה': 'north', 'נהרייה': 'north', 'עפולה': 'north', 'נצרת': 'north', 'נוף הגליל': 'north',
  'נצרת עילית': 'north', 'בית שאן': 'north', 'קצרין': 'north', 'מגדל העמק': 'north', 'יקנעם': 'north',
  'יוקנעם': 'north', 'ראש פינה': 'north', 'חצור הגלילית': 'north', 'שלומי': 'north', 'מעלות': 'north',
  'מעלות תרשיחא': 'north', 'כפר ורדים': 'north', 'טמרה': 'north', 'סחנין': 'north', 'סכנין': 'north',
  'שפרעם': 'north', 'כפר תבור': 'north', 'רמת ישי': 'north', 'מטולה': 'north', 'קרית טבעון': 'north',
  'קריית טבעון': 'north', 'טבעון': 'north', 'צמח': 'north', 'עמק חפר': 'center', 'בית שערים': 'north',
  'גולן': 'north', 'חספין': 'north', 'בוקעאתא': 'north', 'מגדל שמס': 'north', 'עיילבון': 'north',
  // חיפה
  'חיפה': 'haifa', 'קרית אתא': 'haifa', 'קריית אתא': 'haifa', 'קרית ביאליק': 'haifa', 'קריית ביאליק': 'haifa',
  'קרית ים': 'haifa', 'קריית ים': 'haifa', 'קרית מוצקין': 'haifa', 'קריית מוצקין': 'haifa', 'מוצקין': 'haifa',
  'נשר': 'haifa', 'טירת כרמל': 'haifa', 'טירת הכרמל': 'haifa', 'חדרה': 'haifa', 'אור עקיבא': 'haifa',
  'זכרון יעקב': 'haifa', 'זכרון': 'haifa', 'בנימינה': 'haifa', 'פרדס חנה': 'haifa', 'פרדס חנה כרכור': 'haifa', 'כרכור': 'haifa',
  'עתלית': 'haifa', 'דלית אל כרמל': 'haifa', 'דליית אל כרמל': 'haifa', 'דאלית אל כרמל': 'haifa',
  'עוספיה': 'haifa', 'עספיא': 'haifa', 'אום אל פחם': 'haifa', 'באקה אל גרביה': 'haifa',
  'קיסריה': 'haifa', 'שער עליה': 'haifa', 'רכסים': 'haifa', 'קרית חיים': 'haifa', 'קריית חיים': 'haifa',
  // מרכז
  'ראשון לציון': 'center', 'ראשלצ': 'center', 'רחובות': 'center', 'נס ציונה': 'center', 'לוד': 'center',
  'רמלה': 'center', 'פתח תקווה': 'center', 'פתח תקוה': 'center', 'ראש העין': 'center', 'כפר סבא': 'center',
  'רעננה': 'center', 'הוד השרון': 'center', 'נתניה': 'center', 'יבנה': 'center', 'גן יבנה': 'center',
  'מודיעין': 'center', 'מודיעין מכבים רעות': 'center', 'שוהם': 'center', 'שהם': 'center', 'אלעד': 'center', 'גדרה': 'center',
  'באר יעקב': 'center', 'קרית עקרון': 'center', 'קריית עקרון': 'center', 'מזכרת בתיה': 'center',
  'טירה': 'center', 'טייבה': 'center', 'קלנסווה': 'center', 'כפר יונה': 'center', 'אבן יהודה': 'center',
  'תל מונד': 'center', 'צור יצחק': 'center', 'כפר קאסם': 'center', 'ג׳לג׳וליה': 'center', 'גבעת שמואל': 'center',
  'כפר גנים': 'center', 'בית חשמונאי': 'center', 'עין שמר': 'haifa', 'בית דגן': 'center',
  'שדרות וייצמן': 'center', 'סביון': 'center', 'יהוד': 'center', 'יהוד מונוסון': 'center', 'בית דגן': 'center',
  'גני תקווה': 'center', 'קרית אונו': 'telaviv', 'קריית אונו': 'telaviv', 'נחלים': 'center', 'שערי תקווה': 'yosh',
  // תל אביב
  'תל אביב': 'telaviv', 'תל אביב יפו': 'telaviv', 'תא': 'telaviv', 'יפו': 'telaviv', 'רמת גן': 'telaviv',
  'גבעתיים': 'telaviv', 'בני ברק': 'telaviv', 'חולון': 'telaviv', 'בת ים': 'telaviv', 'הרצליה': 'telaviv',
  'הרצלייה': 'telaviv', 'רמת השרון': 'telaviv', 'אור יהודה': 'telaviv', 'אזור': 'telaviv', 'כפר שמריהו': 'telaviv',
  // ירושלים
  'ירושלים': 'jerusalem', 'בית שמש': 'jerusalem', 'מבשרת ציון': 'jerusalem', 'מבשרת': 'jerusalem',
  'אבו גוש': 'jerusalem', 'צור הדסה': 'jerusalem', 'קרית יערים': 'jerusalem', 'טלז סטון': 'jerusalem',
  'מלחה': 'jerusalem', 'תלפיות': 'jerusalem',
  // דרום
  'באר שבע': 'south', 'בש': 'south', 'אשדוד': 'south', 'אשקלון': 'south', 'קרית גת': 'south', 'קריית גת': 'south',
  'קרית מלאכי': 'south', 'קריית מלאכי': 'south', 'שדרות': 'south', 'נתיבות': 'south', 'אופקים': 'south',
  'דימונה': 'south', 'ערד': 'south', 'אילת': 'south', 'רהט': 'south', 'ירוחם': 'south', 'מצפה רמון': 'south',
  'עומר': 'south', 'להבים': 'south', 'מיתר': 'south', 'שדה בוקר': 'south', 'עין יהב': 'south', 'ברנע': 'south',
  'מול שדרות': 'south', 'בית קמה': 'south', 'צומת שוקת': 'south',
  // יהודה ושומרון
  'אריאל': 'yosh', 'מודיעין עילית': 'yosh', 'ביתר עילית': 'yosh', 'מעלה אדומים': 'yosh',
  'קרני שומרון': 'yosh', 'אלקנה': 'yosh', 'אורנית': 'yosh', 'עמנואל': 'yosh', 'בית אל': 'yosh',
  'אפרת': 'yosh', 'גוש עציון': 'yosh', 'קרית ארבע': 'yosh', 'קריית ארבע': 'yosh', 'גבעת זאב': 'yosh',
  'עלי': 'yosh', 'שילה': 'yosh', 'רבבה': 'yosh', 'ברקן': 'yosh', 'אדם': 'yosh', 'כוכב יעקב': 'yosh',
  'ביתר': 'yosh', 'עטרות': 'jerusalem', 'מישור אדומים': 'yosh',
};

// מיזוג רשימת הלמ"ס המלאה (fetch-cities.js) - הטבלה הידנית למעלה גוברת במקרה של כפילות
try {
  const cbs = require('./cities-il.json');
  for (const c of cbs) {
    if (!c.d) continue;
    const key = String(c.n).replace(/["'`׳״]/g, '').replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim();
    if (key && !CITY_TO_DISTRICT[key]) CITY_TO_DISTRICT[key] = c.d;
  }
} catch {}

function normalizeCity(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/["'`׳״]/g, '')
    .replace(/[-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(עיר|ישוב|קיבוץ|מושב)\s/, '')
    .trim();
}

// קיצורים נפוצים → שם מלא (לשאילתות גיאוקוד)
const CANON = {
  'ראשלצ': 'ראשון לציון', 'תא': 'תל אביב', 'בש': 'באר שבע', 'פת': 'פתח תקווה',
  'כס': 'כפר סבא', 'זכרון': 'זכרון יעקב', 'מבשרת': 'מבשרת ציון', 'קרית חיים': 'חיפה',
  'נצרת עילית': 'נוף הגליל', 'שהם': 'שוהם',
};
const canonCity = (c) => CANON[c] || c;

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const boundary = (text, word) => new RegExp('(^| )' + reEsc(word) + '( |$)').test(text);
// שמות יישובים שהם גם מילים נפוצות בכתובות - לא משתתפים בהתאמת-חלקים, רק בהתאמה מדויקת
// ("שער בנימין אזור תעשיה" תאם את העיר אזור; "נווה יעקב" את המושב נווה)
// 'שדרות' - "שדרות משה דיין" (רחוב) תאם את העיר שדרות ושלח סניפי ירושלים/ב"ש לעיר שדרות
// 'אלון' - רחוב יגאל אלון תאם את המושב אלון; 'רמות' - שכונות רמות (י-ם/ב"ש) תאמו את מושב רמות בגולן
const AMBIGUOUS = new Set(['אזור', 'גנים', 'כרמל', 'נווה', 'שפירא', 'אדם', 'עלי', 'שילה', 'מגן', 'שדה', 'ניר', 'גן', 'רם', 'טל אל', 'יעד', 'שער אפרים', 'בת חן', 'חצב', 'ברקן', 'מישר', 'דור', 'רגבה', 'בצת', 'ספיר', 'ברכה', 'שמשית', 'להב', 'ארבל', 'שחר', 'נטע', 'אשל', 'שדרות', 'אלון', 'רמות']);
const fallbackOk = (city) => !AMBIGUOUS.has(city) && (city.length >= 4 || city === 'עכו' || city === 'לוד');

function cityToDistrict(raw) {
  const c = normalizeCity(raw);
  if (CITY_TO_DISTRICT[c]) return CITY_TO_DISTRICT[c];
  // התאמה בגבולות מילים בלבד ("שלי עכו שפירא" → עכו, לא רחוב שפירא);
  // הטבלה הידנית (ערים גדולות) נסרקת לפני רשימת הלמ"ס כי היא הוכנסה ראשונה.
  for (const [city, d] of Object.entries(CITY_TO_DISTRICT)) {
    if (fallbackOk(city) && boundary(c, city)) return d;
  }
  return null;
}

// חילוץ עיר ומחוז מתוך כתובת חופשית ("הכשרת הישוב 3 , ראשון לציון , ישראל")
function fromAddress(addr) {
  if (!addr) return { district: null, city: '' };
  const tokens = String(addr).split(/[,]/).map((t) => normalizeCity(t.replace(/\d+/g, '').trim())).filter(Boolean);
  for (const t of tokens.reverse()) {
    if (t === 'ישראל') continue;
    const d = cityToDistrict(t);
    if (d) return { district: d, city: t };
  }
  return { district: null, city: '' };
}

// חילוץ שם עיר מוכר מתוך טקסט חופשי (למשל שם סניף "דיל כרמיאל- קניון לב").
// קודם בקטע שלפני המקף (שם רשתות שמות את העיר), אחר-כך בטקסט המלא; גבולות מילים בלבד.
function knownCityIn(text) {
  if (!text) return '';
  const segments = [String(text).split(/[-–]/)[0], String(text)];
  for (const seg of segments) {
    const t = normalizeCity(seg);
    if (!t) continue;
    if (CITY_TO_DISTRICT[t]) return t;
    for (const city of Object.keys(CITY_TO_DISTRICT)) {
      if (fallbackOk(city) && boundary(t, city)) return city;
    }
  }
  return '';
}

module.exports = { DISTRICTS, cityToDistrict, normalizeCity, fromAddress, knownCityIn, canonCity };
