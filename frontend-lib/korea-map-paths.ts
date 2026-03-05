// Simplified SVG paths for South Korea 17 provinces (시/도)
// Each path is a simplified polygon for the choropleth map
// viewBox: 0 0 800 1000

export interface RegionPath {
  code: string
  nameKo: string
  nameEn: string
  d: string
  labelX: number
  labelY: number
}

export const KOREA_MAP_PATHS: RegionPath[] = [
  {
    code: "seoul",
    nameKo: "서울",
    nameEn: "Seoul",
    d: "M340,265 L360,258 L378,262 L385,275 L380,290 L365,298 L345,295 L335,280 Z",
    labelX: 358,
    labelY: 278,
  },
  {
    code: "incheon",
    nameKo: "인천",
    nameEn: "Incheon",
    d: "M295,260 L320,248 L340,265 L335,280 L345,295 L330,310 L310,305 L298,290 L290,272 Z",
    labelX: 315,
    labelY: 280,
  },
  {
    code: "gyeonggi",
    nameKo: "경기",
    nameEn: "Gyeonggi",
    d: "M320,200 L360,190 L400,195 L425,210 L435,240 L430,270 L420,300 L400,325 L380,330 L365,298 L380,290 L385,275 L378,262 L360,258 L340,265 L320,248 L295,260 L290,245 L300,220 Z",
    labelX: 395,
    labelY: 250,
  },
  {
    code: "gangwon",
    nameKo: "강원",
    nameEn: "Gangwon",
    d: "M400,195 L450,175 L510,180 L560,200 L580,230 L570,275 L550,320 L520,350 L485,360 L450,345 L425,320 L420,300 L430,270 L435,240 Z",
    labelX: 500,
    labelY: 270,
  },
  {
    code: "sejong",
    nameKo: "세종",
    nameEn: "Sejong",
    d: "M355,370 L375,365 L390,375 L388,392 L372,398 L355,390 Z",
    labelX: 372,
    labelY: 382,
  },
  {
    code: "daejeon",
    nameKo: "대전",
    nameEn: "Daejeon",
    d: "M372,398 L395,395 L408,405 L405,425 L390,432 L375,420 Z",
    labelX: 390,
    labelY: 415,
  },
  {
    code: "chungbuk",
    nameKo: "충북",
    nameEn: "Chungbuk",
    d: "M400,325 L425,320 L450,345 L485,360 L480,395 L460,430 L435,445 L408,435 L408,405 L395,395 L388,392 L390,375 L375,365 L380,330 Z",
    labelX: 440,
    labelY: 390,
  },
  {
    code: "chungnam",
    nameKo: "충남",
    nameEn: "Chungnam",
    d: "M265,330 L310,305 L330,310 L345,295 L365,298 L380,330 L375,365 L355,370 L355,390 L372,398 L375,420 L360,440 L335,455 L310,450 L285,430 L270,405 L260,375 Z",
    labelX: 320,
    labelY: 385,
  },
  {
    code: "daegu",
    nameKo: "대구",
    nameEn: "Daegu",
    d: "M505,480 L530,472 L548,482 L550,502 L535,515 L515,510 L502,495 Z",
    labelX: 525,
    labelY: 495,
  },
  {
    code: "ulsan",
    nameKo: "울산",
    nameEn: "Ulsan",
    d: "M565,510 L590,500 L610,515 L612,545 L595,560 L570,548 L560,528 Z",
    labelX: 588,
    labelY: 530,
  },
  {
    code: "busan",
    nameKo: "부산",
    nameEn: "Busan",
    d: "M545,575 L570,565 L595,560 L600,585 L590,605 L565,612 L545,600 Z",
    labelX: 572,
    labelY: 588,
  },
  {
    code: "gyeongbuk",
    nameKo: "경북",
    nameEn: "Gyeongbuk",
    d: "M485,360 L520,350 L550,320 L570,275 L600,290 L620,330 L625,375 L620,420 L605,460 L590,500 L565,510 L560,528 L548,482 L530,472 L505,480 L502,495 L485,480 L460,430 L480,395 Z",
    labelX: 560,
    labelY: 400,
  },
  {
    code: "gyeongnam",
    nameKo: "경남",
    nameEn: "Gyeongnam",
    d: "M408,435 L408,405 L405,425 L390,432 L408,435 M408,435 L435,445 L460,430 L485,480 L502,495 L515,510 L535,515 L550,502 L548,482 L560,528 L570,548 L570,565 L545,575 L545,600 L520,610 L490,615 L460,600 L430,580 L410,555 L400,520 L395,480 Z",
    labelX: 470,
    labelY: 545,
  },
  {
    code: "jeonbuk",
    nameKo: "전북",
    nameEn: "Jeonbuk",
    d: "M265,455 L310,450 L335,455 L360,440 L375,420 L390,432 L395,480 L385,520 L365,540 L335,548 L305,540 L280,520 L260,495 Z",
    labelX: 328,
    labelY: 495,
  },
  {
    code: "gwangju",
    nameKo: "광주",
    nameEn: "Gwangju",
    d: "M308,580 L330,572 L345,582 L342,600 L325,608 L308,598 Z",
    labelX: 326,
    labelY: 590,
  },
  {
    code: "jeonnam",
    nameKo: "전남",
    nameEn: "Jeonnam",
    d: "M230,540 L260,495 L280,520 L305,540 L335,548 L365,540 L385,520 L395,480 L400,520 L410,555 L430,580 L420,610 L400,640 L370,665 L340,680 L310,690 L280,680 L250,660 L225,630 L210,595 L220,560 Z",
    labelX: 315,
    labelY: 635,
  },
  {
    code: "jeju",
    nameKo: "제주",
    nameEn: "Jeju",
    d: "M240,800 L280,785 L330,780 L370,785 L395,800 L390,825 L365,840 L320,848 L275,840 L248,825 Z",
    labelX: 318,
    labelY: 815,
  },
]

export const MAP_VIEWBOX = "200 160 480 720"
