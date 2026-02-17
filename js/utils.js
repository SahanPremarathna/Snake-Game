export function rnd(n){ return Math.floor(Math.random() * n); }
export function lerp(a,b,t){ return a + (b - a) * t; }

export function storageGet(key, fallback){
  try{
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  }catch(err){
    return fallback;
  }
}

export function storageSet(key, value){
  try{
    localStorage.setItem(key, value);
  }catch(err){}
}

export function hexToRgb(hex){
  hex = hex.trim();
  if(hex.startsWith("rgb")){
    const m = hex.match(/[\d.]+/g);
    return { r:+m[0], g:+m[1], b:+m[2] };
  }
  hex = hex.replace("#","");
  if(hex.length === 3) hex = hex.split("").map(c=>c+c).join("");
  const n = parseInt(hex,16);
  return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
}

export function hexA(hex, a){
  try{
    const c = hexToRgb(hex);
    return "rgba("+c.r+","+c.g+","+c.b+","+a+")";
  }catch(err){
    return "rgba(0,200,255,"+a+")";
  }
}
