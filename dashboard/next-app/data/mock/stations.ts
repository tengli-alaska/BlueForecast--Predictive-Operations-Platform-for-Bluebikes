import type { Station } from "@/types";

export const mockStations: Station[] = [
  // Back Bay
  { station_id: "A32001", station_name: "Back Bay / Stuart St at Dartmouth St", lat: 42.3484, lon: -71.0762, capacity: 24, has_kiosk: true },
  { station_id: "A32002", station_name: "Copley Square - Boylston St at Dartmouth St", lat: 42.3498, lon: -71.0774, capacity: 20, has_kiosk: true },
  { station_id: "A32003", station_name: "Newbury St at Hereford St", lat: 42.3521, lon: -71.0858, capacity: 18, has_kiosk: true },
  { station_id: "A32004", station_name: "Boylston St at Arlington St", lat: 42.3518, lon: -71.0701, capacity: 22, has_kiosk: true },
  { station_id: "A32005", station_name: "Commonwealth Ave at Gloucester St", lat: 42.3527, lon: -71.0866, capacity: 16, has_kiosk: true },

  // Cambridge
  { station_id: "A32006", station_name: "MIT at Mass Ave / Amherst St", lat: 42.3581, lon: -71.0936, capacity: 30, has_kiosk: true },
  { station_id: "A32007", station_name: "Harvard Square at Brattle St / Eliot St", lat: 42.3735, lon: -71.1218, capacity: 28, has_kiosk: true },
  { station_id: "A32008", station_name: "Central Square at Mass Ave / Essex St", lat: 42.3651, lon: -71.1032, capacity: 26, has_kiosk: true },
  { station_id: "A32009", station_name: "Kendall/MIT T Station", lat: 42.3625, lon: -71.0862, capacity: 24, has_kiosk: true },
  { station_id: "A32010", station_name: "Cambridge Main Library / Broadway at Trowbridge St", lat: 42.3734, lon: -71.1109, capacity: 18, has_kiosk: true },

  // Somerville
  { station_id: "A32011", station_name: "Davis Square / Holland St", lat: 42.3969, lon: -71.1225, capacity: 22, has_kiosk: true },
  { station_id: "A32012", station_name: "Union Square - Somerville", lat: 42.3796, lon: -71.0946, capacity: 20, has_kiosk: true },
  { station_id: "A32013", station_name: "Porter Square Station", lat: 42.3884, lon: -71.1191, capacity: 18, has_kiosk: true },
  { station_id: "A32014", station_name: "Teele Square / Broadway at Curtis St", lat: 42.4004, lon: -71.1285, capacity: 14, has_kiosk: true },
  { station_id: "A32015", station_name: "Magoun Square / Medford St at Lowell St", lat: 42.3988, lon: -71.1066, capacity: 12, has_kiosk: false },

  // South End
  { station_id: "A32016", station_name: "Tremont St at West Brookline St", lat: 42.3413, lon: -71.0757, capacity: 20, has_kiosk: true },
  { station_id: "A32017", station_name: "Washington St at Lenox St", lat: 42.3378, lon: -71.0792, capacity: 18, has_kiosk: true },
  { station_id: "A32018", station_name: "Columbus Ave at Mass Ave", lat: 42.3396, lon: -71.0815, capacity: 22, has_kiosk: true },
  { station_id: "A32019", station_name: "Harrison Ave at E Dedham St", lat: 42.3369, lon: -71.0729, capacity: 16, has_kiosk: true },
  { station_id: "A32020", station_name: "Peters Park - Washington St at Shawmut Ave", lat: 42.3408, lon: -71.0742, capacity: 14, has_kiosk: true },

  // Allston
  { station_id: "A32021", station_name: "Packard's Corner - Commonwealth Ave at Brighton Ave", lat: 42.3519, lon: -71.1323, capacity: 20, has_kiosk: true },
  { station_id: "A32022", station_name: "Harvard Ave at Brighton Ave", lat: 42.3532, lon: -71.1311, capacity: 18, has_kiosk: true },
  { station_id: "A32023", station_name: "Allston Green District / Harvard Ave at Cambridge St", lat: 42.3542, lon: -71.1295, capacity: 16, has_kiosk: true },
  { station_id: "A32024", station_name: "Commonwealth Ave at Griggs St", lat: 42.3489, lon: -71.1349, capacity: 14, has_kiosk: true },
  { station_id: "A32025", station_name: "N Beacon St at Everett St", lat: 42.3553, lon: -71.1414, capacity: 12, has_kiosk: false },

  // Brookline
  { station_id: "A32026", station_name: "Coolidge Corner - Beacon St at Centre St", lat: 42.3420, lon: -71.1229, capacity: 22, has_kiosk: true },
  { station_id: "A32027", station_name: "Brookline Village / Station St at Pearl St", lat: 42.3325, lon: -71.1171, capacity: 18, has_kiosk: true },
  { station_id: "A32028", station_name: "Washington Square / Beacon St at Washington St", lat: 42.3400, lon: -71.1347, capacity: 16, has_kiosk: true },
  { station_id: "A32029", station_name: "JFK Crossing / Harvard St at Thorndike St", lat: 42.3440, lon: -71.1233, capacity: 14, has_kiosk: true },

  // Fenway
  { station_id: "A32030", station_name: "Kenmore Square - Commonwealth Ave at Beacon St", lat: 42.3489, lon: -71.0955, capacity: 26, has_kiosk: true },
  { station_id: "A32031", station_name: "Fenway Park - Boylston St at Ipswich St", lat: 42.3465, lon: -71.0979, capacity: 24, has_kiosk: true },
  { station_id: "A32032", station_name: "Longwood Medical Area / Longwood Ave at Brookline Ave", lat: 42.3387, lon: -71.1057, capacity: 22, has_kiosk: true },
  { station_id: "A32033", station_name: "Museum of Fine Arts - Huntington Ave at Museum Rd", lat: 42.3376, lon: -71.0954, capacity: 18, has_kiosk: true },
  { station_id: "A32034", station_name: "Northeastern University - Forsyth St at Huntington Ave", lat: 42.3398, lon: -71.0895, capacity: 20, has_kiosk: true },

  // Downtown / Financial District
  { station_id: "A32035", station_name: "Downtown Crossing - Washington St at Summer St", lat: 42.3555, lon: -71.0604, capacity: 28, has_kiosk: true },
  { station_id: "A32036", station_name: "South Station - Atlantic Ave at Summer St", lat: 42.3523, lon: -71.0551, capacity: 30, has_kiosk: true },
  { station_id: "A32037", station_name: "Post Office Square - Congress St at Pearl St", lat: 42.3562, lon: -71.0534, capacity: 24, has_kiosk: true },
  { station_id: "A32038", station_name: "Boston Common - Tremont St at Park St", lat: 42.3560, lon: -71.0641, capacity: 26, has_kiosk: true },
  { station_id: "A32039", station_name: "Faneuil Hall - Union St at North St", lat: 42.3602, lon: -71.0567, capacity: 22, has_kiosk: true },

  // North End
  { station_id: "A32040", station_name: "North End - Hanover St at Cross St", lat: 42.3634, lon: -71.0548, capacity: 20, has_kiosk: true },
  { station_id: "A32041", station_name: "Lewis Wharf - Atlantic Ave at Commercial St", lat: 42.3641, lon: -71.0500, capacity: 18, has_kiosk: true },
  { station_id: "A32042", station_name: "Paul Revere Park / Commercial St at Hull St", lat: 42.3662, lon: -71.0543, capacity: 14, has_kiosk: true },

  // Charlestown
  { station_id: "A32043", station_name: "Bunker Hill Monument / Monument Sq", lat: 42.3763, lon: -71.0609, capacity: 16, has_kiosk: true },
  { station_id: "A32044", station_name: "Charlestown Navy Yard / 1st Ave at Chestnut St", lat: 42.3736, lon: -71.0533, capacity: 18, has_kiosk: true },
  { station_id: "A32045", station_name: "Sullivan Square Station", lat: 42.3847, lon: -71.0727, capacity: 20, has_kiosk: true },

  // South Boston
  { station_id: "A32046", station_name: "Broadway T Station - Dorchester Ave at Broadway", lat: 42.3425, lon: -71.0571, capacity: 22, has_kiosk: true },
  { station_id: "A32047", station_name: "Marine Park - Day Blvd at Farragut Rd", lat: 42.3345, lon: -71.0291, capacity: 14, has_kiosk: true },
  { station_id: "A32048", station_name: "L St at E Broadway", lat: 42.3374, lon: -71.0376, capacity: 16, has_kiosk: true },
  { station_id: "A32049", station_name: "Seaport Blvd at Sleeper St", lat: 42.3513, lon: -71.0490, capacity: 24, has_kiosk: true },
  { station_id: "A32050", station_name: "Convention Center / D St at W Service Rd", lat: 42.3474, lon: -71.0445, capacity: 10, has_kiosk: false },
];
