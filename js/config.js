// ════════════════════════════════════════════════════════
//  APP SETTINGS  —  js/config.js
//  Change prices, limits, bank and WhatsApp details here.
//  (Never put passwords in this file — everything here is public.)
// ════════════════════════════════════════════════════════
window.APP_CONFIG = {
  FIREBASE: {
    apiKey:            "AIzaSyAjtuJdH9TCg3ZrnU_bp49dyu32UdRitxI",
    authDomain:        "ky-cgpa.firebaseapp.com",
    projectId:         "ky-cgpa",
    storageBucket:     "ky-cgpa.firebasestorage.app",
    messagingSenderId: "541735260813",
    appId:             "1:541735260813:web:94277c1ba2f37f473b48c4"
  },

  // Only this Google account can open /admin (the database rules enforce it too)
  ADMIN_EMAIL: "augusdavik@gmail.com",

  // true  = everyone must sign in with Google to use the app
  // false = sign-in is optional (people can still use the calculator as guests)
  REQUIRE_LOGIN: true,

  // Result library limits
  FREE_LOCAL_MAX_FILES:     4,   // free users: total files kept on their device
  PREMIUM_MAX_PER_SEMESTER: 4,   // premium: files per level + semester, saved to account
  MAX_FILE_MB:   2,              // PDF / Word files
  MAX_IMAGE_MB:  15,             // photos are auto-compressed after picking
  IMAGE_TARGET_KB: 450,          // compressed photo size goal

  // Premium
  PRICE_NAIRA:  2000,
  PREMIUM_DAYS: 365,
  SUPPORT_DAYS: 5,               // "we reply within 5 working days"
  WHATSAPP_NUMBER: "2348157896621",   // payment proofs come to this number

  PAY: {
    ACCOUNT_NAME:   "Augustine Ikechukwu David",
    ACCOUNT_NUMBER: "9138072232",
    BANK_NAME:      ""            // <-- type your bank name here, e.g. "Opay" or "GTBank"
  }
};
