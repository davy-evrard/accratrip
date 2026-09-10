// Jeu de données du voyage : catégories, jours du séjour et lieux.
// Modifier ce fichier suffit pour ajouter/retirer un lieu - aucune autre
// partie du code n'a besoin d'être touchée.

export const CATEGORIES = {
  logement: { label: "Logement", color: "#c9a227", icon: "🛏️" },
  centre: { label: "Centre-ville & culture", color: "#c1543c", icon: "🏛️" },
  sorties: { label: "Sorties, shopping & bord de mer", color: "#3a9298", icon: "🏖️" },
  aburi: { label: "Excursion à Aburi", color: "#5c9468", icon: "🌳" },
  musee: { label: "Musée", color: "#9b6fa3", icon: "🖼️" },
};

// Les 5 jours du séjour, pour le planner par jour.
export const DAYS = [
  { n: 1, label: "Jour 1", date: "mer. 7 oct." },
  { n: 2, label: "Jour 2", date: "jeu. 8 oct." },
  { n: 3, label: "Jour 3", date: "ven. 9 oct." },
  { n: 4, label: "Jour 4", date: "sam. 10 oct." },
  { n: 5, label: "Jour 5", date: "dim. 11 oct." },
];

export const PLACES = [
  {
    id: "parkside",
    name: "Parkside City Apts",
    category: "logement",
    lat: 5.6005779,
    lng: -0.1241031,
    mapsUrl: "https://maps.google.com/?cid=12119824882953789497",
    description:
      "Notre point de chute principal à Accra : des appartements modernes et confortables, dans un quartier calme, parfaits pour se poser après les longues journées d'exploration.",
  },
  {
    id: "hills",
    name: "✨THE HILLS✨",
    category: "logement",
    lat: 5.6391878,
    lng: -0.257174,
    mapsUrl: "https://maps.google.com/?cid=11759453831122783048",
    description:
      "Notre deuxième logement du séjour, niché en hauteur avec une jolie vue sur les environs - un bon changement d'ambiance pour la suite du voyage.",
  },
  {
    id: "chrismaison",
    name: "Chrismaisonfood",
    category: "sorties",
    lat: 5.6666209,
    lng: -0.1801107,
    mapsUrl: "https://maps.google.com/?q=5.6666209,-0.1801107",
    description:
      "Un restaurant local chaleureux où se régaler de plats ghanéens faits maison.",
  },
  {
    id: "artcenter",
    name: "Accra Arts Centre",
    category: "centre",
    lat: 5.545627,
    lng: -0.2014851,
    mapsUrl: "https://maps.google.com/?cid=2852541378761323859",
    description:
      "Le grand marché artisanal d'Accra : sculptures en bois, tissus kente, bijoux et souvenirs à foison. Prévoyez du temps (et un peu de négociation) pour dénicher la bonne pièce.",
  },
  {
    id: "osu",
    name: "Osu Castle (Christiansborg)",
    category: "centre",
    lat: 5.5471211,
    lng: -0.1841269,
    mapsUrl: "https://maps.google.com/?cid=1279063471797699879",
    description:
      "Cet ancien fort danois du XVIIe siècle a traversé l'histoire du pays, de comptoir colonial à siège du gouvernement ghanéen. Un lieu chargé de mémoire, juste au bord de l'océan.",
  },
  {
    id: "labadi",
    name: "Labadi Beach",
    category: "sorties",
    lat: 5.562204,
    lng: -0.1385295,
    mapsUrl: "https://maps.google.com/?cid=6609692905825325145",
    description:
      "La plage la plus animée d'Accra : sable, musique live, vendeurs ambulants et ambiance festive garantie, surtout le week-end.",
  },
  {
    id: "gallery1957",
    name: "Gallery 1957",
    category: "centre",
    lat: 5.5539068,
    lng: -0.1972,
    mapsUrl: "https://maps.google.com/?cid=4856538779698445153",
    description:
      "Une galerie d'art contemporain qui met en lumière des artistes africains et de la diaspora. Une pause culturelle bienvenue entre deux visites.",
  },
  {
    id: "zoo",
    name: "Accra Zoo",
    category: "centre",
    lat: 5.6176101,
    lng: -0.2154337,
    mapsUrl: "https://maps.google.com/?cid=8315894046676764312",
    description:
      "Le zoo national, entre lions, primates et oiseaux locaux. Une sortie sympa pour souffler un peu, surtout appréciée en groupe.",
  },
  {
    id: "independence",
    name: "Independence Arch",
    category: "centre",
    lat: 5.549579,
    lng: -0.1911144,
    mapsUrl: "https://maps.google.com/?cid=15110592571853313409",
    description:
      "L'arche de l'Indépendance et la place Black Star Square, symboles de la libération du Ghana en 1957. Un incontournable pour comprendre l'histoire du pays.",
  },
  {
    id: "nkrumah",
    name: "Kwame Nkrumah Memorial Park",
    category: "centre",
    lat: 5.5444368,
    lng: -0.2026379,
    mapsUrl: "https://maps.google.com/?cid=14216590836270695150",
    description:
      "Le mémorial dédié à Kwame Nkrumah, premier président du Ghana : mausolée, statue et petit musée retraçant la lutte pour l'indépendance.",
  },
  {
    id: "livingroom",
    name: "The Living Room Restaurant",
    category: "sorties",
    lat: 5.6467701,
    lng: -0.1695891,
    mapsUrl: "https://maps.google.com/?cid=8647296604616604383",
    description:
      "Un restaurant prisé pour ses soirées animées, sa musique et sa carte qui mélange saveurs locales et internationales. Bonne adresse pour une sortie de groupe.",
  },
  {
    id: "bella",
    name: "Bella Afrikana Beach Club",
    category: "sorties",
    lat: 5.5537326,
    lng: -0.1623031,
    mapsUrl: "https://maps.google.com/?cid=15160807808171884800",
    description:
      "Un beach club où siroter un cocktail les pieds dans le sable, avec vue sur l'océan - parfait pour un coucher de soleil entre amis.",
  },
  {
    id: "mall",
    name: "Accra Mall",
    category: "sorties",
    lat: 5.6221003,
    lng: -0.1733501,
    mapsUrl: "https://maps.google.com/?cid=8493392076117582914",
    description:
      "Le grand centre commercial d'Accra : boutiques, cinéma, restaurants et supermarché, utile pour les derniers achats ou juste une pause climatisée.",
  },
  {
    id: "aburi",
    name: "Aburi Botanical Gardens & Park",
    category: "aburi",
    lat: 5.8510672,
    lng: -0.1729752,
    mapsUrl: "https://maps.google.com/?cid=15910516408812889792",
    description:
      "Un jardin botanique perché en altitude, loin de l'agitation de la ville : arbres centenaires, air frais et jolie balade au calme. Comptez environ une heure de route depuis Accra.",
  },
  {
    id: "ecopark",
    name: "Eco Park (Aburi)",
    category: "aburi",
    lat: 6.0055904,
    lng: -0.2565503,
    mapsUrl: "https://maps.google.com/?q=6.0055904,-0.2565503",
    description:
      "Un parc nature proche d'Aburi, pensé pour les activités en plein air.",
  },
  {
    id: "despite",
    name: "Despite Automobile Museum",
    category: "musee",
    lat: 5.6433759,
    lng: -0.1524826,
    mapsUrl: "https://maps.google.com/?cid=4171566690206355870",
    description:
      "Un musée automobile insolite qui expose une collection impressionnante de voitures anciennes et de luxe. Une curiosité qui change des visites classiques.",
  },
];
