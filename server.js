const express=require('express'),fs=require('fs'),path=require('path'),crypto=require('crypto'),{DatabaseSync}=require('node:sqlite');
const app=express();let mailer=null;try{if(process.env.SMTP_HOST)mailer=require('nodemailer').createTransport({host:process.env.SMTP_HOST,port:+process.env.SMTP_PORT||587,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}})}catch{}app.use(express.json({limit:'12mb'}));
const D=path.join(__dirname,'data'),U=path.join(D,'uploads');fs.mkdirSync(U,{recursive:true});
const db=new DatabaseSync(path.join(D,'ajrak.db'));db.exec('PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;');
const prep=db.prepare.bind(db);db.prepare=sql=>{const st=prep(sql),n=a=>a.map(v=>v===undefined?null:v);return{get:(...a)=>st.get(...n(a)),all:(...a)=>st.all(...n(a)),run:(...a)=>st.run(...n(a))}};
let dp=0;db.transaction=fn=>(...a)=>{if(dp)return fn(...a);dp=1;db.exec('BEGIN');try{const r=fn(...a);db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}finally{dp=0}};
db.exec(`
CREATE TABLE IF NOT EXISTS departments(id INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS categories(id TEXT PRIMARY KEY,label TEXT NOT NULL,department_id INTEGER NOT NULL REFERENCES departments(id),base_weight INTEGER NOT NULL,keywords TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,login TEXT UNIQUE NOT NULL,role TEXT NOT NULL,name TEXT NOT NULL,caste TEXT,area TEXT,nic TEXT UNIQUE,phone TEXT,photo TEXT,salt TEXT,hash TEXT,active INTEGER DEFAULT 1,created_at INTEGER);
CREATE TABLE IF NOT EXISTS complaints(id TEXT PRIMARY KEY,text TEXT NOT NULL,reporter TEXT,address TEXT,lat REAL,lng REAL,
 category_id TEXT NOT NULL REFERENCES categories(id),confidence INTEGER,auto_classified INTEGER,department_id INTEGER NOT NULL REFERENCES departments(id),
 photo TEXT,evidence TEXT,status TEXT NOT NULL DEFAULT 'Assigned',reports INTEGER NOT NULL DEFAULT 1,duplicate_of TEXT REFERENCES complaints(id),
 priority_score INTEGER,priority TEXT,created_at INTEGER NOT NULL,user_id INTEGER REFERENCES users(id),assigned_to INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS timeline(id INTEGER PRIMARY KEY AUTOINCREMENT,complaint_id TEXT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,status TEXT,note TEXT,evidence TEXT,created_at INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),created_at INTEGER);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
CREATE INDEX IF NOT EXISTS ix_c ON complaints(category_id,status);CREATE INDEX IF NOT EXISTS ix_u ON complaints(user_id,assigned_to);`);
for(const t of['users','complaints'])try{db.exec('ALTER TABLE '+t+' ADD COLUMN demo INTEGER DEFAULT 0')}catch{}
for(const q of['ALTER TABLE users ADD COLUMN email TEXT','CREATE UNIQUE INDEX IF NOT EXISTS ux_email ON users(email)','CREATE TABLE IF NOT EXISTS resets(user_id INTEGER,code TEXT,expires INTEGER,tries INTEGER DEFAULT 0)'])try{db.exec(q)}catch{}
const getS=k=>{const r=db.prepare('SELECT value FROM settings WHERE key=?').get(k);return r?JSON.parse(r.value):null};
const setS=(k,v)=>db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,JSON.stringify(v));
const sha=(p,s)=>crypto.scryptSync(p,s,32).toString('hex');
const mkUser=o=>{const s=o.salt||crypto.randomBytes(16).toString('hex');return db.prepare('INSERT INTO users(login,role,name,caste,area,nic,phone,photo,salt,hash,created_at,demo,email) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(o.login,o.role,o.name,o.caste,o.area,o.nic,o.phone,o.photo,s,o.hash||sha(o.password,s),Date.now(),o.demo?1:0,o.email?String(o.email).toLowerCase():null).lastInsertRowid};
const slug=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,30);
const dept=n=>{db.prepare('INSERT OR IGNORE INTO departments(name) VALUES(?)').run(n);return db.prepare('SELECT id FROM departments WHERE name=?').get(n).id};
if(!db.prepare('SELECT 1 FROM departments').get()){
 [['streetlight','Streetlight','Electricity Department',30,'street light,streetlight,lamp,bulb,dark,pole,light,bijli,batti,andhera,sparking'],
  ['road','Damaged Road','Roads & Highways',40,'road,pothole,crack,asphalt,sadak,gaddha,bridge,speed breaker'],
  ['garbage','Garbage / Bins','Sanitation Department',25,'garbage,trash,bin,waste,kachra,dump,rubbish,smell,overflowing'],
  ['water','Water Leakage','Water & Sanitation Agency',45,'water,leak,leakage,pipe,pipeline,paani,burst,tap,supply'],
  ['drain','Blocked Drain','Drainage Department',45,'drain,sewer,sewage,gutter,manhole,nali,blocked,clog,overflow,flood']
 ].forEach(c=>db.prepare('INSERT INTO categories VALUES(?,?,?,?,?)').run(c[0],c[1],dept(c[2]),c[3],c[4]));
 setS('rules',{urgent:['accident','danger','dangerous','sparking','flood','child','children','school','hospital','shock','open manhole','injury','emergency'],dupRadius:150,dupSim:0.15,dupBoost:8,ageBoostPerDay:2,urgentBoost:20,thresholds:{critical:80,high:60,medium:40}});
 mkUser({login:'admin',role:'admin',name:'Administrator',area:'Khairpur',email:'admin@sindhcivic.pk',password:'admin123'});
 mkUser({login:'manager',role:'manager',name:'City Manager',area:'Khairpur',email:'manager@sindhcivic.pk',password:'manager123'});
 mkUser({login:'attender1',role:'staff',name:'Field Attender 1',area:'Khairpur',phone:'03001234567',email:'attender1@sindhcivic.pk',password:'staff123'})}
for(const[l,e]of[['admin','admin'],['manager','manager'],['attender1','attender1']])db.prepare('UPDATE users SET email=? WHERE login=? AND email IS NULL').run(e+'@sindhcivic.pk',l)
const tok=s=>(s.toLowerCase().match(/[a-z\u0600-\u06ff]{3,}/g)||[]);
function classify(text,chosen){const t=text.toLowerCase();let best=null,tot=0,sc={};
 for(const c of db.prepare('SELECT id,keywords FROM categories').all()){sc[c.id]=c.keywords.split(',').map(x=>x.trim()).filter(Boolean).reduce((a,w)=>a+(t.includes(w)?(w.includes(' ')?2:1):0),0);tot+=sc[c.id];if(!best||sc[c.id]>sc[best])best=c.id}
 if(tot>0)return{category:best,confidence:Math.round(100*sc[best]/tot),auto:1};
 const ok=db.prepare('SELECT 1 FROM categories WHERE id=?').get(chosen);return{category:ok?chosen:best,confidence:ok?100:30,auto:0}}
const dist=(a,b,c,d)=>{const R=6371000,r=x=>x*Math.PI/180,dl=r(c-a),dn=r(d-b),h=Math.sin(dl/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(h))};
const sim=(a,b)=>{const x=new Set(tok(a)),y=new Set(tok(b));if(!x.size||!y.size)return 0;let i=0;x.forEach(w=>y.has(w)&&i++);return i/(x.size+y.size-i)};
function prio(r,cf){const w=db.prepare('SELECT base_weight w FROM categories WHERE id=?').get(r.category_id).w,t=r.text.toLowerCase();
 let s=Math.min(100,w+cf.urgent.filter(x=>t.includes(x)).length*cf.urgentBoost+(r.reports-1)*cf.dupBoost+Math.floor((Date.now()-r.created_at)/864e5)*cf.ageBoostPerDay);
 const h=cf.thresholds;db.prepare('UPDATE complaints SET priority_score=?,priority=? WHERE id=?').run(s,s>=h.critical?'Critical':s>=h.high?'High':s>=h.medium?'Medium':'Low',r.id)}
const ROW='SELECT c.*,cat.label AS categoryLabel,d.name AS department,u.name AS rname,u.phone AS rphone,u.nic AS rnic,u.area AS rarea,s.name AS sname FROM complaints c JOIN categories cat ON cat.id=c.category_id JOIN departments d ON d.id=c.department_id LEFT JOIN users u ON u.id=c.user_id LEFT JOIN users s ON s.id=c.assigned_to';
const one=id=>db.prepare(ROW+' WHERE c.id=?').get(id);
const tl=(id,s,n,ev)=>db.prepare('INSERT INTO timeline(complaint_id,status,note,evidence,created_at) VALUES(?,?,?,?,?)').run(id,s,n,ev||null,Date.now());
function pub(r,role){const o={id:r.id,text:r.text,category:r.category_id,categoryLabel:r.categoryLabel,department:r.department,address:r.address,lat:r.lat,lng:r.lng,status:r.status,priority:r.priority,priorityScore:r.priority_score,reports:r.reports,duplicateOf:r.duplicate_of,confidence:r.confidence,autoClassified:!!r.auto_classified,photo:r.photo,evidence:r.evidence,createdAt:r.created_at,
 timeline:db.prepare('SELECT status s,note n,created_at t,evidence FROM timeline WHERE complaint_id=? ORDER BY id').all(r.id)};
 if(role){o.assignedTo=r.assigned_to;o.assignedName=r.sname;o.reporter={name:r.rname||r.reporter,phone:r.rphone,area:r.rarea};if(role!=='staff')o.reporter.nic=r.rnic}return o}
function photo(d){const m=/^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(d||'');if(!m)return null;const n=crypto.randomUUID()+'.'+m[1].replace('jpeg','jpg');fs.writeFileSync(path.join(U,n),Buffer.from(m[2],'base64'));return'/uploads/'+n}
const create=db.transaction((b,img,uid,reporter,area)=>{const text=String(b.text||'').slice(0,1000),lat=+b.lat,lng=+b.lng,cl=classify(text,b.category),cat=db.prepare('SELECT * FROM categories WHERE id=?').get(cl.category);
 const m=db.prepare("SELECT MAX(CAST(SUBSTR(id,5) AS INTEGER)) m FROM complaints").get().m,id='CMP-'+((m||1000)+1),cf=getS('rules');
 const st=area?db.prepare("SELECT u.id,u.name FROM users u WHERE u.role='staff' AND u.active=1 AND lower(u.area)=lower(?) ORDER BY (SELECT COUNT(*) FROM complaints c WHERE c.assigned_to=u.id AND c.status!='Resolved') LIMIT 1").get(area):null;
 db.prepare('INSERT INTO complaints(id,text,reporter,address,lat,lng,category_id,confidence,auto_classified,department_id,photo,status,reports,created_at,user_id,assigned_to) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)')
  .run(id,text,reporter,String(b.address||area||'').slice(0,120),lat,lng,cl.category,cl.confidence,cl.auto,cat.department_id,img,'Assigned',Date.now(),uid,st?st.id:null);
 tl(id,'Submitted','Complaint received');tl(id,'Assigned','Auto-routed to '+db.prepare('SELECT name FROM departments WHERE id=?').get(cat.department_id).name);if(st)tl(id,'Assigned','Field attender: '+st.name+' (same area)');
 const p=db.prepare("SELECT * FROM complaints WHERE duplicate_of IS NULL AND status!='Resolved' AND category_id=? AND id!=?").all(cl.category,id).find(o=>{const d=dist(o.lat,o.lng,lat,lng);return d<30||(d<cf.dupRadius&&sim(o.text,text)>=cf.dupSim)});
 if(p){db.prepare('UPDATE complaints SET duplicate_of=? WHERE id=?').run(p.id,id);db.prepare('UPDATE complaints SET reports=reports+1 WHERE id=?').run(p.id);prio(one(p.id),cf);tl(id,'Assigned','Linked to existing report '+p.id)}
 prio(one(id),cf);return one(id)});
const bad=(r,m)=>r.status(400).json({error:m});
const safe=u=>({id:u.id,role:u.role,name:u.name,caste:u.caste,area:u.area,phone:u.phone,nic:u.nic,photo:u.photo,login:u.login,email:u.email});
const sess=(r,id)=>{const t=crypto.randomUUID();db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(t,id,Date.now());r.json({token:t,user:safe(db.prepare('SELECT * FROM users WHERE id=?').get(id))})};
const need=(...roles)=>(q,r,n)=>{const u=db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.active=1').get(q.headers['x-token']||'');
 if(!u||(roles.length&&!roles.includes(u.role)))return r.status(u?403:401).json({error:u?'Not allowed for your role':'Please log in'});q.user=u;n()};
const STAFF=['admin','manager','staff'],MGR=['admin','manager'];

const FIRST=['Ali Raza','Ghulam Mustafa','Imran','Abdul Rehman','Zulfiqar','Mehran','Shahid','Naveed','Kashif','Aamir','Sajjad','Waseem','Farhan','Irfan','Nadeem','Rashid','Tariq','Asif','Bilawal','Sikandar','Ayesha','Fatima','Sana','Zainab','Hina','Rubina','Saima','Nazia','Amna','Mariam'],CASTE=['Soomro','Mirani','Talpur','Jatoi','Shaikh','Memon','Abro','Chandio','Khoso','Lashari','Brohi','Bhutto'];
const AREAS=[['Station Road',0,0],['Court Road',.006,.003],['Jinnah Colony',-.003,.004],['Gulshan Area',-.005,-.002],['Dari Mohalla',.002,-.004],['Shikarpur Road',.004,.002],['Ranipur Road',.012,-.006],['Mirwah Road',-.008,.009],['Old Town',.001,.007],['Civil Lines',-.002,-.007]];
const TPL=[['Street light pole is not working for many days and the whole lane is dark at night','Broken lamp near the mosque, andhera and unsafe for women and children','Electric pole sparking near the school gate, very dangerous'],
['Big pothole on the main road, bikes are slipping every day','Road is badly cracked and broken near the market, traffic jam daily','Sadak ka gaddha accident ka sabab ban raha hai near the bridge'],
['Garbage bin overflowing for a week and kachra spread on the street','Waste dump near the school with a terrible smell','Trash is not collected and rubbish is piling up near the hospital'],
['Water pipeline burst and paani leaking onto the road all day','Leakage in the main pipe, water supply is very low in our street','Tap water not coming and pipe leaking near the mosque'],
['Drain blocked and sewage overflow entering houses','Gutter is clogged and dirty water standing in the street, flood risk','Open manhole on the road, dangerous for children']];
const clearDemo=db.transaction(()=>{const U='(SELECT id FROM users WHERE demo=1)';db.prepare('UPDATE complaints SET duplicate_of=NULL WHERE demo=1 OR duplicate_of IN (SELECT id FROM complaints WHERE demo=1)').run();db.prepare('UPDATE complaints SET assigned_to=NULL WHERE assigned_to IN '+U).run();
 db.prepare('DELETE FROM complaints WHERE demo=1').run();db.prepare('DELETE FROM sessions WHERE user_id IN '+U).run();db.prepare('DELETE FROM users WHERE demo=1').run()});
const loadDemo=db.transaction(()=>{clearDemo();const S='demo-salt',H=sha('demo123',S),HS=sha('staff123',S),now=Date.now();
 [['demo_att1','Demo Attender (Station Rd)',0],['demo_att2','Demo Attender (Jinnah Colony)',2],['demo_att3','Demo Attender (Dari)',4]].forEach(a=>mkUser({login:a[0],role:'staff',name:a[1],area:AREAS[a[2]][0],phone:'03001112233',email:a[0]+'@example.pk',salt:S,hash:HS,demo:1}));
 for(let i=0;i<50;i++){const f=FIRST[i%30],ca=CASTE[(i*7)%12],ar=AREAS[i%10],name=f+' '+ca,nic='41301'+String(i*7919+10000000).padStart(8,'0').slice(-8),ph='0300'+String(1000000+i*37123).slice(-7);
  fs.writeFileSync(path.join(U,'demo_'+i+'.svg'),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${['#8b0f14','#1f1f1f','#6b2d5c','#0f766e','#b45309'][i%5]}"/><text x="50" y="62" font-size="38" text-anchor="middle" fill="#fff" font-family="Arial">${f[0]}${ca[0]}</text></svg>`);
  const uid=mkUser({login:nic,role:'citizen',name,caste:ca,area:ar[0],nic,phone:ph,photo:'/uploads/demo_'+i+'.svg',email:(f.split(' ')[0]+'.'+ca+i).toLowerCase()+'@example.pk',salt:S,hash:H,demo:1}),cat=i%5,j=(i*3+Math.floor(i/5))%3,jit=((i*13)%7-3)*0.0002;
  const c=create({text:TPL[cat][j],lat:27.5295+ar[1]+jit,lng:68.7592+ar[2]-jit,address:ar[0]},null,uid,name,ar[0]),at=now-((i*7)%14)*864e5-(i%24)*36e5;
  db.prepare('UPDATE complaints SET created_at=?,demo=1 WHERE id=?').run(at,c.id);db.prepare('UPDATE timeline SET created_at=? WHERE complaint_id=?').run(at,c.id);
  if(i%4==1&&!c.duplicate_of){db.prepare("UPDATE complaints SET status='In Progress' WHERE id=?").run(c.id);tl(c.id,'In Progress','Crew dispatched')}
  if(i%5==2&&!c.duplicate_of){db.prepare("UPDATE complaints SET status='Resolved' WHERE id=?").run(c.id);tl(c.id,'Resolved','Issue fixed by the department crew')}}
 const cf=getS('rules');db.prepare('SELECT * FROM complaints').all().forEach(x=>prio(x,cf))});
app.get('/api/admin/demo',need('admin'),(q,r)=>r.json({users:db.prepare("SELECT COUNT(*) n FROM users WHERE demo=1 AND role='citizen'").get().n}));
app.post('/api/admin/demo',need('admin'),(q,r)=>{q.body.action==='clear'?clearDemo():loadDemo();setS('demoSeeded',true);r.json({ok:1})});
if(!getS('demoSeeded')&&!db.prepare('SELECT 1 FROM complaints').get()){loadDemo();setS('demoSeeded',true);console.log('Loaded 50 demo citizens and complaints')}
if(!getS('demo_seeded')){setS('demo_seeded',1);if(!db.prepare('SELECT 1 FROM complaints').get())loadDemo()}
app.patch('/api/admin/bulk',need(...MGR),(q,r)=>{const{ids,action,staffId,status}=q.body;if(!Array.isArray(ids)||!ids.length)return bad(r,'Select complaints first');
 if(action==='assign'){const s=staffId?db.prepare("SELECT * FROM users WHERE id=? AND role='staff'").get(staffId):null;if(staffId&&!s)return bad(r,'Pick a field attender');
  db.transaction(()=>ids.forEach(id=>{db.prepare('UPDATE complaints SET assigned_to=? WHERE id=?').run(staffId||null,id);tl(id,(db.prepare('SELECT status FROM complaints WHERE id=?').get(id)||{}).status,s?'Assigned to '+s.name+' by '+q.user.name:'Unassigned by '+q.user.name)}))()}
 else if(['Assigned','In Progress'].includes(status))db.transaction(()=>ids.forEach(id=>{db.prepare("UPDATE complaints SET status=? WHERE id=? AND status!='Resolved'").run(status,id);tl(id,status,'Bulk update by '+q.user.name)}))();
 else return bad(r,'Choose an action. Resolving needs a photo, so do it one by one.');r.json({ok:ids.length})});
app.use(express.static(path.join(__dirname,'public')));app.use('/uploads',express.static(U));
app.get('/api/meta',(q,r)=>r.json({cats:Object.fromEntries(db.prepare('SELECT id,label FROM categories').all().map(c=>[c.id,c.label]))}));
app.post('/api/register',(q,r)=>{const b=q.body,nic=String(b.nic||'').replace(/\D/g,''),ph=String(b.phone||'').replace(/[\s-]/g,'').replace(/^\+92/,'0'),pw=String(b.password||'');
 if(String(b.name||'').trim().length<3)return bad(r,'Enter your full name');if(!String(b.caste||'').trim())return bad(r,'Enter your caste');if(!String(b.area||'').trim())return bad(r,'Enter your area');
 const em=String(b.email||'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em))return bad(r,'Enter a valid email address');if(!/^\d{13}$/.test(nic))return bad(r,'NIC must be exactly 13 digits (numbers only, no dashes)');if(!/^03\d{9}$/.test(ph))return bad(r,'Phone must be exactly 11 digits, like 03001234567');if(pw.length<6)return bad(r,'Password needs 6+ characters');
 if(db.prepare('SELECT 1 FROM users WHERE nic=?').get(nic))return bad(r,'This NIC is already registered. Please log in or reset your password.');if(db.prepare('SELECT 1 FROM users WHERE lower(email)=?').get(em))return bad(r,'This email is already registered');if(db.prepare("SELECT 1 FROM users WHERE phone=? AND role='citizen'").get(ph))return bad(r,'This phone number is already registered');
 const img=photo(b.photo);if(!img)return bad(r,'Upload your profile photo');
 sess(r,mkUser({email:em,login:nic,role:'citizen',name:b.name.trim().slice(0,60),caste:b.caste.trim().slice(0,40),area:b.area.trim().slice(0,60),nic,phone:ph,photo:img,password:pw}))});
app.post('/api/login',(q,r)=>{let l=String(q.body.login||'').trim();if(/^[\d-]{13,15}$/.test(l))l=l.replace(/\D/g,'');const u=db.prepare('SELECT * FROM users WHERE (login=? OR lower(email)=?) AND active=1').get(l,l.toLowerCase());
 if(u&&crypto.timingSafeEqual(Buffer.from(sha(String(q.body.password||''),u.salt)),Buffer.from(u.hash)))return sess(r,u.id);r.status(401).json({error:'Wrong NIC/username or password'})});
const findU=l=>{l=String(l||'').trim().toLowerCase();const d=l.replace(/\D/g,'');return db.prepare('SELECT * FROM users WHERE active=1 AND (lower(email)=? OR login=? OR nic=?)').get(l,l,d.length===13?d:'x')};
app.post('/api/forgot',async(q,r)=>{const u=findU(q.body.login),out={ok:1,message:'If this account exists, a 6-digit reset code has been emailed.'};
 if(u&&u.email&&(mailer||(u.role==='citizen'&&process.env.NODE_ENV!=='production'))){const code=String(crypto.randomInt(100000,1000000));db.prepare('DELETE FROM resets WHERE user_id=?').run(u.id);db.prepare('INSERT INTO resets(user_id,code,expires) VALUES(?,?,?)').run(u.id,sha(code,'reset'),Date.now()+9e5);
  if(mailer){try{await mailer.sendMail({from:process.env.MAIL_FROM||process.env.SMTP_USER,to:u.email,subject:'Sindh Civic Triage password reset',text:'Your reset code is '+code+'. It expires in 15 minutes.'})}catch(e){console.log('Mail error',e.message)}}
  else{console.log('[DEMO MAIL] reset code for',u.email,':',code);out.demoCode=code;out.message='No email server is configured (demo mode), so your code is shown here instead of being emailed.'}}
 else if(u&&!u.email)out.message='This account has no email on file. Ask the administrator to reset your password.';r.json(out)});
app.post('/api/reset',(q,r)=>{const u=findU(q.body.login),pw=String(q.body.password||'');if(pw.length<6)return bad(r,'Password needs 6+ characters');const rs=u&&db.prepare('SELECT * FROM resets WHERE user_id=?').get(u.id);
 if(!rs||rs.expires<Date.now())return bad(r,'Invalid or expired code');if(rs.code!==sha(String(q.body.code||'').trim(),'reset')){db.prepare('UPDATE resets SET tries=tries+1 WHERE user_id=?').run(u.id);if(rs.tries>=4)db.prepare('DELETE FROM resets WHERE user_id=?').run(u.id);return bad(r,'Invalid or expired code')}
 const s=crypto.randomBytes(16).toString('hex');db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(s,sha(pw,s),u.id);db.prepare('DELETE FROM resets WHERE user_id=?').run(u.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);r.json({ok:1})});
app.get('/api/me',need(),(q,r)=>r.json({user:safe(q.user)}));
app.post('/api/complaints',need('citizen'),(q,r)=>{const b=q.body,u=q.user;if(!b.text||b.text.length<8||isNaN(+b.lat)||isNaN(+b.lng))return bad(r,'Describe the problem (min 8 characters) and set a location');
 if(db.prepare('SELECT COUNT(*) n FROM complaints WHERE user_id=? AND created_at>?').get(u.id,Date.now()-864e5).n>=5)return bad(r,'Daily limit reached (5 complaints per day)');
 r.json(pub(create(b,photo(b.photo),u.id,u.name,u.area)))});
app.get('/api/my/complaints',need('citizen'),(q,r)=>r.json(db.prepare(ROW+' WHERE c.user_id=? ORDER BY c.created_at DESC').all(q.user.id).map(x=>pub(x))));
app.get('/api/complaints/:id',(q,r)=>{const c=one(q.params.id.toUpperCase());c?r.json(pub(c)):r.status(404).json({error:'No complaint found with that ID'})});
const cnt=(a,f)=>a.reduce((m,x)=>{const k=f(x);m[k]=(m[k]||0)+1;return m},{});
app.get('/api/admin/complaints',need(...STAFF),(q,r)=>{const cf=getS('rules'),role=q.user.role,sla=cf.slaDays||3;db.prepare("SELECT * FROM complaints WHERE status!='Resolved'").all().forEach(x=>prio(x,cf));
 const rows=role==='staff'?db.prepare(ROW+' WHERE c.assigned_to=? ORDER BY c.priority_score DESC').all(q.user.id):db.prepare(ROW+' ORDER BY c.priority_score DESC').all(),items=rows.map(x=>pub(x,role)),open=items.filter(i=>i.status!=='Resolved');
 const days=[...Array(14)].map((_,i)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-13+i);return d}),trend={labels:days.map(d=>d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})),values:days.map(d=>items.filter(i=>i.createdAt>=+d&&i.createdAt<+d+864e5).length)};
 r.json({items,stats:{total:items.length,open:open.length,critical:open.filter(i=>i.priority==='Critical').length,resolved:items.length-open.length,duplicates:items.filter(i=>i.duplicateOf).length,
  citizens:db.prepare("SELECT COUNT(*) n FROM users WHERE role='citizen'").get().n,byCategory:cnt(items,i=>i.categoryLabel),byStatus:cnt(items,i=>i.status),byPriority:cnt(open,i=>i.priority),
  dupByCat:cnt(items.filter(i=>i.duplicateOf),i=>i.categoryLabel),byArea:cnt(items,i=>(i.address||'Unknown').split(',')[0].slice(0,26)),overdue:open.filter(i=>Date.now()-i.createdAt>sla*864e5).length,sla,activity:role==='staff'?[]:db.prepare('SELECT t.complaint_id id,t.status,t.note,t.created_at ts,cat.label cl FROM timeline t JOIN complaints c ON c.id=t.complaint_id JOIN categories cat ON cat.id=c.category_id ORDER BY t.id DESC LIMIT 8').all(),workload:cnt(open.filter(i=>i.assignedName),i=>i.assignedName),trend}})});
app.post('/api/admin/complaints',need('admin'),(q,r)=>{const b=q.body;if(!b.text||b.text.length<8)return bad(r,'Describe the problem (min 8 characters)');r.json(pub(create({...b,lat:b.lat||27.5295,lng:b.lng||68.7592},photo(b.photo),null,b.name||'Walk-in / phone',b.area||b.address),'admin'))});
app.patch('/api/admin/complaints/:id',need(...STAFF),(q,r)=>{const c=one(q.params.id);if(!c)return r.status(404).json({error:'Not found'});if(q.user.role==='staff'&&c.assigned_to!==q.user.id)return r.status(403).json({error:'Not your task'});
 const{status,note,photo:p}=q.body;if(!['Assigned','In Progress','Resolved'].includes(status))return bad(r,'Bad status');const img=photo(p);if(status==='Resolved'&&!img&&!c.evidence)return bad(r,'Upload a resolution photo as evidence');
 db.transaction(()=>{db.prepare('UPDATE complaints SET status=?,evidence=COALESCE(?,evidence) WHERE id=?').run(status,img,c.id);tl(c.id,status,(note||'Status updated')+' - '+q.user.name,img);
  db.prepare('SELECT id FROM complaints WHERE duplicate_of=?').all(c.id).forEach(d=>{db.prepare('UPDATE complaints SET status=?,evidence=COALESCE(?,evidence) WHERE id=?').run(status,img||c.evidence,d.id);tl(d.id,status,'Updated via '+c.id)})})();r.json(pub(one(c.id),q.user.role))});
app.patch('/api/admin/complaints/:id/assign',need(...MGR),(q,r)=>{const c=one(q.params.id),sid=q.body.staffId||null,s=sid?db.prepare("SELECT * FROM users WHERE id=? AND role='staff'").get(sid):null;if(!c)return r.status(404).json({error:'Not found'});if(sid&&!s)return bad(r,'Pick a field attender');
 db.prepare('UPDATE complaints SET assigned_to=? WHERE id=?').run(sid,c.id);tl(c.id,c.status,s?'Assigned to '+s.name+' by '+q.user.name:'Unassigned by '+q.user.name);r.json(pub(one(c.id),q.user.role))});
app.put('/api/admin/complaints/:id',need('admin'),(q,r)=>{const c=one(q.params.id),b=q.body;if(!c)return r.status(404).json({error:'Not found'});const cat=db.prepare('SELECT * FROM categories WHERE id=?').get(b.category||c.category_id);if(!cat)return bad(r,'Bad category');
 db.prepare('UPDATE complaints SET text=?,address=?,category_id=?,department_id=? WHERE id=?').run(String(b.text||c.text).slice(0,1000),String(b.address??c.address).slice(0,120),cat.id,cat.department_id,c.id);tl(c.id,c.status,'Details edited by '+q.user.name);prio(one(c.id),getS('rules'));r.json(pub(one(c.id),'admin'))});
app.delete('/api/admin/complaints/:id',need('admin'),(q,r)=>{db.transaction(()=>{db.prepare('UPDATE complaints SET duplicate_of=NULL WHERE duplicate_of=?').run(q.params.id);db.prepare('DELETE FROM complaints WHERE id=?').run(q.params.id)})();r.json({ok:1})});
app.get('/api/admin/categories',need(...STAFF),(q,r)=>r.json(db.prepare('SELECT cat.id,cat.label,d.name department,cat.base_weight weight,cat.keywords,(SELECT COUNT(*) FROM complaints c WHERE c.category_id=cat.id) total FROM categories cat JOIN departments d ON d.id=cat.department_id ORDER BY cat.label').all()));
const catIn=b=>{if(!String(b.label||'').trim()||!String(b.department||'').trim())throw Error('Name and department are required');return[b.label.trim(),dept(b.department.trim()),Number.isFinite(+b.weight)?Math.max(0,Math.min(100,+b.weight)):30,String(b.keywords||'').toLowerCase()]};
app.post('/api/admin/categories',need('admin'),(q,r)=>{try{const[l,d,w,k]=catIn(q.body);db.prepare('INSERT INTO categories VALUES(?,?,?,?,?)').run(slug(l)||'cat_'+Date.now(),l,d,w,k);r.json({ok:1})}catch(e){bad(r,/UNIQUE/.test(e.message)?'Category already exists':e.message)}});
app.put('/api/admin/categories/:id',need('admin'),(q,r)=>{try{const[l,d,w,k]=catIn(q.body);db.prepare('UPDATE categories SET label=?,department_id=?,base_weight=?,keywords=? WHERE id=?').run(l,d,w,k,q.params.id);
 db.prepare('UPDATE complaints SET department_id=? WHERE category_id=?').run(d,q.params.id);const cf=getS('rules');db.prepare('SELECT * FROM complaints').all().forEach(x=>prio(x,cf));r.json({ok:1})}catch(e){bad(r,e.message)}});
app.delete('/api/admin/categories/:id',need('admin'),(q,r)=>{if(db.prepare('SELECT 1 FROM complaints WHERE category_id=?').get(q.params.id))return bad(r,'This category has complaints and cannot be deleted');db.prepare('DELETE FROM categories WHERE id=?').run(q.params.id);r.json({ok:1})});
app.get('/api/admin/users',need(...MGR),(q,r)=>r.json(db.prepare('SELECT id,login,email,role,name,caste,area,nic,phone,photo,active,demo,created_at,(SELECT COUNT(*) FROM complaints WHERE user_id=users.id) complaints,(SELECT COUNT(*) FROM complaints WHERE assigned_to=users.id AND status!=\'Resolved\') tasks,(SELECT COUNT(*) FROM complaints WHERE assigned_to=users.id AND status=\'Resolved\') resolved,(SELECT ROUND(AVG((t.created_at-c.created_at)/3600000.0),1) FROM complaints c JOIN timeline t ON t.complaint_id=c.id AND t.status=\'Resolved\' WHERE c.assigned_to=users.id) avgh FROM users ORDER BY role,name').all()));
app.post('/api/admin/users',need('admin'),(q,r)=>{const b=q.body;if(!['manager','staff'].includes(b.role)||!b.login||!b.name||String(b.password||'').length<6)return bad(r,'Role, login, name and a 6+ character password are required');
 try{mkUser({login:String(b.login).trim().toLowerCase(),role:b.role,name:b.name,area:b.area,phone:b.phone,password:b.password});r.json({ok:1})}catch(e){bad(r,'That login already exists')}});
app.put('/api/admin/users/:id',need('admin'),(q,r)=>{const b=q.body,u=db.prepare('SELECT * FROM users WHERE id=?').get(q.params.id);if(!u)return r.status(404).json({error:'Not found'});
 db.prepare('UPDATE users SET name=?,caste=?,area=?,phone=?,email=?,active=?,role=? WHERE id=?').run(b.name||u.name,b.caste??u.caste,b.area??u.area,b.phone??u.phone,b.email!==undefined?(String(b.email).trim().toLowerCase()||null):u.email,b.active===undefined?u.active:(b.active?1:0),u.role==='citizen'||u.role==='admin'?u.role:(['manager','staff'].includes(b.role)?b.role:u.role),u.id);
 if(b.password&&b.password.length>=6){const s=crypto.randomBytes(16).toString('hex');db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(s,sha(b.password,s),u.id)}r.json({ok:1})});
app.delete('/api/admin/users/:id',need('admin'),(q,r)=>{const id=+q.params.id;if(id===q.user.id)return bad(r,'You cannot delete yourself');
 db.transaction(()=>{db.prepare('UPDATE complaints SET assigned_to=NULL WHERE assigned_to=?').run(id);db.prepare('UPDATE complaints SET user_id=NULL WHERE user_id=?').run(id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);db.prepare('DELETE FROM users WHERE id=?').run(id)})();r.json({ok:1})});
app.get('/api/admin/config',need(...MGR),(q,r)=>r.json({slaDays:3,...getS('rules')}));
app.put('/api/admin/config',need('admin'),(q,r)=>{const b=q.body,ru=getS('rules');for(const k of['urgent','dupRadius','dupSim','dupBoost','ageBoostPerDay','urgentBoost','thresholds','slaDays'])if(b[k]!==undefined)ru[k]=b[k];
 if([ru.dupRadius,ru.dupBoost,ru.urgentBoost,ru.ageBoostPerDay].some(v=>!Number.isFinite(+v)))return bad(r,'Invalid numbers');setS('rules',ru);db.prepare('SELECT * FROM complaints').all().forEach(x=>prio(x,ru));r.json(ru)});
app.get('/api/admin/export',need(...MGR),(q,r)=>{const E=v=>'"'+String(v??'').replace(/"/g,'""')+'"',rows=db.prepare(ROW+' ORDER BY c.created_at DESC').all();
 r.type('text/csv').send('\ufeff'+['ID,Date,Category,Department,Status,Priority,Score,Similar reports,Area/Address,Reporter,NIC,Phone,Assigned to,Description'].concat(rows.map(c=>[c.id,new Date(c.created_at).toISOString().slice(0,16).replace('T',' '),c.categoryLabel,c.department,c.status,c.priority,c.priority_score,c.reports-1,c.address,c.rname||c.reporter,c.rnic,c.rphone,c.sname,c.text].map(E).join(','))).join('\n'))});
app.use((e,q,r,n)=>r.status(400).json({error:/UNIQUE/.test(String(e.message))?'That NIC, email or login is already used':'Request failed'}));
const P=process.env.PORT||3000;app.listen(P,'0.0.0.0',()=>console.log('Sindh Civic Triage running on http://localhost:'+P));
