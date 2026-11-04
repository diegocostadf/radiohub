// Sets icon and version info on RadioHub.exe without Wine (pure JS resedit).
const fs = require('fs'); const ResEdit = require('resedit'); const PE = require('pe-library');
const [exePath, icoPath, version] = process.argv.slice(2);
const exe = PE.NtExecutable.from(fs.readFileSync(exePath));
const res = PE.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const gid = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, lang, ico.icons.map((i) => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
const [a, b, c] = version.split('.').map(Number);
vi.setFileVersion(a, b, c, 0, 1033); vi.setProductVersion(a, b, c, 0, 1033);
vi.setStringValues({ lang: 1033, codepage: 1200 }, {
  ProductName: 'RadioHub', FileDescription: 'RadioHub', CompanyName: 'Diego Costa',
  LegalCopyright: '© 2026 Diego Costa · GPL v3', OriginalFilename: 'RadioHub.exe', InternalName: 'RadioHub',
  FileVersion: version, ProductVersion: version
});
vi.outputToResourceEntries(res.entries);
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('ok', exePath);
