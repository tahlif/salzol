// רשימת הרשתות האחת והיחידה - fetch/build/geocode/osm-pois כולם קוראים מכאן.
// type: shufersal / cerberus (url.publishedprices.co.il) / hazihinam / carrefour
// brand: זיהוי ה-POI של הרשת במפת OSM
module.exports = [
  { id: 'shufersal', name: 'שופרסל', type: 'shufersal', chainId: '7290027600007', brand: /שופרסל|shufersal/i },
  { id: 'ramilevy', name: 'רמי לוי', type: 'cerberus', user: 'RamiLevi', chainId: '7290058140886', brand: /רמי לוי|rami levy/i },
  { id: 'osherad', name: 'אושר עד', type: 'cerberus', user: 'osherad', chainId: '7290103152017', brand: /אושר עד|osher ?ad/i },
  { id: 'yohananof', name: 'יוחננוף', type: 'cerberus', user: 'yohananof', chainId: '7290803800003', brand: /יוחננוף|yohananof/i },
  { id: 'tivtaam', name: 'טיב טעם', type: 'cerberus', user: 'TivTaam', chainId: '7290873255550', brand: /טיב טעם|tiv ta/i },
  { id: 'hazihinam', name: 'חצי חינם', type: 'hazihinam', chainId: '7290700100008', uniform: true, priceStore: '103', brand: /חצי חינם|ha[tz]?zi hinam/i },
  { id: 'carrefour', name: 'קרפור', type: 'carrefour', chainId: '7290055700007', brand: /קרפור|carrefour/i },
  { id: 'keshet', name: 'קשת טעמים', type: 'cerberus', user: 'Keshet', chainId: '7290785400000', brand: /קשת טעמים|keshet/i },
  { id: 'salachd', name: 'סאלח דבאח', type: 'cerberus', user: 'SalachD', chainId: '7290526500006', brand: /סאלח דבאח|סלאח|salach/i },
  { id: 'stopmarket', name: 'סטופ מרקט', type: 'cerberus', user: 'Stop_Market', chainId: '7290639000004', brand: /סטופ ?מרקט|stop ?market/i },
  { id: 'politzer', name: 'פוליצר', type: 'cerberus', user: 'politzer', chainId: '7291059100008', brand: /פוליצר|politzer/i },
  { id: 'freshmarket', name: 'פרשמרקט', type: 'cerberus', user: 'freshmarket', chainId: '7290876100000', brand: /פרש ?מרקט|fresh ?market/i },
  // רשתות בפלטפורמת binaprojects: רשימת קבצים ב-MainIO_Hok.aspx (WFileType: 1=סניפים, 4=מחירים מלא), הורדה ב-Download/<קובץ>
  { id: 'supersapir', name: 'סופר ספיר', type: 'bina', sub: 'supersapir', chainId: '7290058156016', brand: /סופר ספיר|super ?sapir/i },
  { id: 'kingstore', name: 'קינג סטור', type: 'bina', sub: 'kingstore', chainId: '7290058108879', brand: /קינג סטור|king ?store/i },
  { id: 'maayan2000', name: 'מעיין 2000', type: 'bina', sub: 'maayan2000', chainId: '7290058159628', brand: /מעיין אלפיים|מעיין 2000|maayan/i },
  { id: 'zolvebegadol', name: 'זול ובגדול', type: 'bina', sub: 'zolvebegadol', chainId: '7290058173198', brand: /זול ובגדול/i },
  { id: 'superbareket', name: 'סופר ברקת', type: 'bina', sub: 'superbareket', chainId: '7290875100001', brand: /סופר ברקת|super ?bareket/i },
  { id: 'shefabirkathashem', name: 'שפע ברכת השם', type: 'bina', sub: 'shefabirkathashem', chainId: '7290058134977', brand: /שפע ברכת/i },
  { id: 'shukhayir', name: 'שוק העיר', type: 'bina', sub: 'shuk-hayir', chainId: '7290058148776', brand: /שוק העיר/i },
];
