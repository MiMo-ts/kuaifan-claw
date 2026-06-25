const fs = require('fs');
const path = require('path');

function rmrf(p) {
  // Use lstat to get info without following junctions
  let lst;
  try { lst = fs.lstatSync(p); } catch(e) { return; }
  if (lst.isSymbolicLink()) {
    try { fs.unlinkSync(p); } catch(e) {}
    return;
  }
  if (!lst.isDirectory()) {
    try { fs.unlinkSync(p); } catch(e) {}
    return;
  }
  // Directory
  let items;
  try { items = fs.readdirSync(p, { withFileTypes: true }); }
  catch(e) { return; }
  for (const item of items) {
    rmrf(path.join(p, item.name));
  }
  try { fs.rmdirSync(p); } catch(e) {}
}

const target = 'D:\\kuaifanclaw\\win\\bin\\data';
rmrf(target);
console.log(fs.existsSync(target) ? 'STILL EXISTS' : 'GONE');
