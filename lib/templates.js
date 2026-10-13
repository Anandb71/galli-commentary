'use strict';

// Built-in commentary used when the LLM is slow or unavailable.
// {bat} = batter, {bowl} = bowler. Two variants per event so repeats feel less robotic.
const TEMPLATES = {
  'hi-IN': {
    dot: ['{bowl} की शानदार गेंद, कोई रन नहीं! प्रेशर बढ़ता जा रहा है।', 'डॉट बॉल! {bat} बस देखते रह गए।'],
    single: ['{bat} ने हल्के से धकेला और एक रन ले लिया।', 'स्मार्ट क्रिकेट! सिंगल लेकर स्ट्राइक रोटेट।'],
    two: ['गैप में खेला और दौड़कर दो रन! बढ़िया रनिंग बिटवीन द विकेट्स।', '{bat} ने दो रन चुरा लिए, फील्डर देखता रह गया!'],
    four: ['चौका! {bat} का कमाल का शॉट, गेंद गोली की तरह बाउंड्री पार!', 'फोर! फील्डर हिल भी नहीं पाया, क्या टाइमिंग है!'],
    six: ['छक्का! {bat} ने गेंद को स्टेडियम के बाहर भेज दिया!', 'ये गया आसमान में... सिक्स! {bowl} सिर पकड़ के खड़े हैं!'],
    bowled: ['बोल्ड! {bowl} ने गिल्लियाँ उड़ा दीं, {bat} पवेलियन लौटेंगे!', 'क्लीन बोल्ड! स्टंप्स बिखर गए, क्या गेंद है!'],
    caught: ['कैच! और {bat} आउट! {bowl} को मिला बड़ा विकेट!', 'हवा में गई और सुरक्षित हाथों में! {bat} की पारी खत्म!'],
    lbw: ['एलबीडब्ल्यू! अंपायर की उंगली ऊपर, {bat} को जाना होगा!', 'पैड पर लगी, सीधा स्टंप्स के सामने... आउट!'],
    wide: ['वाइड! {bowl} की लाइन भटक गई, एक्स्ट्रा रन।', 'ये तो बाहर निकल गई, अंपायर ने वाइड दिया।'],
    noball: ['नो बॉल! और अगली गेंद फ्री हिट!', 'ओवरस्टेप! {bowl} से बड़ी गलती, फ्री हिट आ रहा है!'],
    dropped: ['अरे! कैच छूट गया! {bat} को मिला जीवनदान!', 'ड्रॉप! इतना आसान कैच... ये मैच महंगा पड़ सकता है!'],
    free: ['क्या पल है! पूरा स्टेडियम खड़ा हो गया!', 'गज़ब का क्रिकेट! रोमांच अपने चरम पर है!'],
  },
  'ta-IN': {
    dot: ['{bowl} அருமையான பந்து, ரன் இல்லை! பிரஷர் ஏறுது!', 'டாட் பால்! {bat} பார்த்துக்கிட்டே நிக்கிறார்.'],
    single: ['{bat} மெதுவா தள்ளி ஒரு ரன் எடுத்தார்.', 'ஸ்மார்ட் கிரிக்கெட்! சிங்கிள் எடுத்து ஸ்ட்ரைக் மாற்றம்.'],
    two: ['கேப்ல அடிச்சு ரெண்டு ரன் ஓடிட்டாங்க! சூப்பர் ரன்னிங்!', '{bat} ரெண்டு ரன் திருடிட்டார்!'],
    four: ['ஃபோர்! {bat} அடிச்ச ஷாட் பவுண்டரிக்கு பறந்தது!', 'நான்கு ரன்! ஃபீல்டர் அசையவே இல்லை, என்ன டைமிங்!'],
    six: ['சிக்ஸ்! {bat} பந்தை ஸ்டேடியம் வெளியே அனுப்பிட்டார்!', 'வானத்துல பறக்குது... சிக்ஸர்! {bowl} தலையில கை!'],
    bowled: ['போல்ட்! {bowl} ஸ்டம்ப்ஸை தகர்த்தார், {bat} அவுட்!', 'கிளீன் போல்ட்! பெயில்ஸ் பறந்தது!'],
    caught: ['கேட்ச்! {bat} அவுட்! {bowl}க்கு பெரிய விக்கெட்!', 'உயரமா போய் பத்திரமான கையில! {bat} இன்னிங்ஸ் முடிஞ்சது!'],
    lbw: ['எல்பிடபிள்யூ! அம்பயர் விரல் மேல, {bat} போகணும்!', 'பேட்ல பட்டது, ஸ்டம்ப்ஸ் முன்னாடி... அவுட்!'],
    wide: ['வைட்! {bowl} லைன் தவறிட்டார், ஒரு எக்ஸ்ட்ரா ரன்.', 'வெளியே போயிடுச்சு, அம்பயர் வைட் கொடுத்தார்.'],
    noball: ['நோ பால்! அடுத்தது ஃப்ரீ ஹிட்!', 'ஓவர்ஸ்டெப்! {bowl} பெரிய தப்பு, ஃப்ரீ ஹிட் வருது!'],
    dropped: ['ஐயோ! கேட்ச் விட்டுட்டாங்க! {bat}க்கு இன்னொரு வாய்ப்பு!', 'டிராப்! இவ்வளவு ஈசி கேட்ச்... இது காஸ்ட்லியா போகலாம்!'],
    free: ['என்ன ஒரு தருணம்! முழு ஸ்டேடியமும் எழுந்து நிக்குது!', 'அட்டகாசமான கிரிக்கெட்! பதட்டம் உச்சத்தில!'],
  },
  'te-IN': {
    dot: ['{bowl} అద్భుతమైన బంతి, పరుగు లేదు! ప్రెషర్ పెరుగుతోంది!', 'డాట్ బాల్! {bat} చూస్తూ ఉండిపోయారు.'],
    single: ['{bat} మెల్లగా నెట్టి ఒక పరుగు తీశారు.', 'స్మార్ట్ క్రికెట్! సింగిల్ తీసి స్ట్రైక్ మార్చారు.'],
    two: ['గ్యాప్‌లో కొట్టి రెండు పరుగులు! సూపర్ రన్నింగ్!', '{bat} రెండు పరుగులు దొంగిలించారు!'],
    four: ['ఫోర్! {bat} షాట్ బౌండరీకి దూసుకెళ్లింది!', 'బౌండరీ! ఫీల్డర్ కదలలేదు కూడా, ఏం టైమింగ్!'],
    six: ['సిక్స్! {bat} బంతిని స్టేడియం బయటికి పంపారు!', 'ఆకాశంలోకి... సిక్సర్! {bowl} తల పట్టుకున్నారు!'],
    bowled: ['బౌల్డ్! {bowl} స్టంప్స్ ఎగరగొట్టారు, {bat} అవుట్!', 'క్లీన్ బౌల్డ్! బెయిల్స్ గాల్లో ఎగిరాయి!'],
    caught: ['క్యాచ్! {bat} అవుట్! {bowl}కి పెద్ద వికెట్!', 'గాల్లోకి లేచి సురక్షితమైన చేతుల్లోకి! {bat} ఇన్నింగ్స్ ముగిసింది!'],
    lbw: ['ఎల్బీడబ్ల్యూ! అంపైర్ వేలు పైకి, {bat} వెళ్లాల్సిందే!', 'ప్యాడ్‌కి తగిలింది, స్టంప్స్ ముందే... అవుట్!'],
    wide: ['వైడ్! {bowl} లైన్ తప్పారు, ఒక ఎక్స్‌ట్రా పరుగు.', 'బయటికి వెళ్లింది, అంపైర్ వైడ్ ఇచ్చారు.'],
    noball: ['నో బాల్! తర్వాతది ఫ్రీ హిట్!', 'ఓవర్‌స్టెప్! {bowl} పెద్ద తప్పు, ఫ్రీ హిట్ వస్తోంది!'],
    dropped: ['అయ్యో! క్యాచ్ వదిలేశారు! {bat}కి మరో ఛాన్స్!', 'డ్రాప్! ఇంత సులువైన క్యాచ్... ఇది ఖరీదైనది కావచ్చు!'],
    free: ['ఏం క్షణం! స్టేడియం మొత్తం లేచి నిలబడింది!', 'అద్భుతమైన క్రికెట్! ఉత్కంఠ తారాస్థాయికి!'],
  },
  'bn-IN': {
    dot: ['{bowl}-এর দুর্দান্ত বল, কোনো রান নেই! চাপ বাড়ছে!', 'ডট বল! {bat} শুধু তাকিয়ে রইলেন।'],
    single: ['{bat} আলতো করে ঠেলে এক রান নিলেন।', 'স্মার্ট ক্রিকেট! সিঙ্গেল নিয়ে স্ট্রাইক বদল।'],
    two: ['গ্যাপে খেলে দৌড়ে দুই রান! দারুণ রানিং!', '{bat} দুটো রান চুরি করে নিলেন!'],
    four: ['চার! {bat}-এর শট গুলির মতো বাউন্ডারি পার!', 'বাউন্ডারি! ফিল্ডার নড়তেই পারলেন না, কী টাইমিং!'],
    six: ['ছক্কা! {bat} বলটা স্টেডিয়ামের বাইরে পাঠিয়ে দিলেন!', 'আকাশে উড়ে গেল... ছয়! {bowl} মাথায় হাত!'],
    bowled: ['বোল্ড! {bowl} স্টাম্প উড়িয়ে দিলেন, {bat} আউট!', 'ক্লিন বোল্ড! বেলস উড়ে গেল!'],
    caught: ['ক্যাচ! {bat} আউট! {bowl} পেলেন বড় উইকেট!', 'আকাশে উঠে নিরাপদ হাতে! {bat}-এর ইনিংস শেষ!'],
    lbw: ['এলবিডব্লিউ! আম্পায়ারের আঙুল উপরে, {bat}-কে যেতে হবে!', 'প্যাডে লেগেছে, সোজা স্টাম্পের সামনে... আউট!'],
    wide: ['ওয়াইড! {bowl}-এর লাইন ভুল, একটা এক্সট্রা রান।', 'বাইরে চলে গেল, আম্পায়ার ওয়াইড দিলেন।'],
    noball: ['নো বল! পরের বল ফ্রি হিট!', 'ওভারস্টেপ! {bowl}-এর বড় ভুল, ফ্রি হিট আসছে!'],
    dropped: ['ইশ! ক্যাচ পড়ে গেল! {bat} পেলেন নতুন জীবন!', 'ড্রপ! এত সহজ ক্যাচ... এটা মহার্ঘ হতে পারে!'],
    free: ['কী মুহূর্ত! গোটা স্টেডিয়াম উঠে দাঁড়িয়েছে!', 'অসাধারণ ক্রিকেট! উত্তেজনা চরমে!'],
  },
  'en-IN': {
    dot: ['Superb from {bowl}, no run! The pressure is building.', 'Dot ball! {bat} beaten all ends up.'],
    single: ['{bat} nudges it away and scampers through for one.', 'Smart cricket, a single to rotate the strike.'],
    two: ['Into the gap and they come back for two! Lovely running.', '{bat} steals a couple, the fielder is caught napping!'],
    four: ['FOUR! {bat} creams it, that raced away like a bullet!', 'Boundary! The fielder did not even move, what timing!'],
    six: ['SIX! {bat} sends it into the stands!', 'That is huge... maximum! {bowl} cannot believe it!'],
    bowled: ['BOWLED HIM! {bowl} rattles the stumps, {bat} has to walk!', 'Clean bowled! The bails are flying, what a delivery!'],
    caught: ['CAUGHT! {bat} is gone! Huge wicket for {bowl}!', 'Up in the air and taken safely! That is the end of {bat}!'],
    lbw: ['LBW! The finger goes up, {bat} has to go!', 'Rapped on the pads, plumb in front... OUT!'],
    wide: ['Wide! {bowl} loses the line, one extra.', 'Drifting down leg, the umpire signals wide.'],
    noball: ['No-ball! And that means a FREE HIT!', 'Overstepped! Big mistake from {bowl}, free hit coming up!'],
    dropped: ['Oh no, DROPPED! {bat} gets a life!', 'Put down! A dolly of a catch... that could prove costly!'],
    free: ['What a moment! The whole stadium is on its feet!', 'Incredible scenes! The tension is through the roof!'],
  },
};

// Used when no names were entered.
const DEFAULT_NAMES = {
  'hi-IN': ['बल्लेबाज़', 'गेंदबाज़'],
  'ta-IN': ['பேட்ஸ்மேன்', 'பவுலர்'],
  'te-IN': ['బ్యాటర్', 'బౌలర్'],
  'bn-IN': ['ব্যাটার', 'বোলার'],
  'en-IN': ['the batter', 'the bowler'],
};

let counter = 0;

function fallbackLine(lang, event, batter, bowler) {
  const byLang = TEMPLATES[lang] || TEMPLATES['en-IN'];
  const options = byLang[event] || byLang.free;
  const line = options[counter++ % options.length];
  const [bat, bowl] = DEFAULT_NAMES[lang] || DEFAULT_NAMES['en-IN'];
  return line.replace(/\{bat\}/g, batter || bat).replace(/\{bowl\}/g, bowler || bowl);
}

module.exports = { TEMPLATES, fallbackLine };
