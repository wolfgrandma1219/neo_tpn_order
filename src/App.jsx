import React, { useState, useEffect, useMemo } from 'react';
import { 
  User, Lock, Settings, Users, FileText, Plus, 
  Search, ArrowLeft, Save, CheckCircle, XCircle, 
  Edit, AlertTriangle, Syringe, Trash2, CloudUpload
} from 'lucide-react';

// === 未來串接 Google Apps Script 的網址請填入此處 ===
const GAS_URL = "https://script.google.com/macros/s/您的部署ID/exec";

// --- 初始化模擬資料 (對應未來的 Google Sheets) ---
const INITIAL_USERS = [
  { id: 'u1', username: 'admin', password: '123', role: 'admin', name: '系統管理員' },
  { id: 'u2', username: 'dr', password: '123', role: 'doctor', name: '王醫師' },
  { id: 'u3', username: 'np', password: '123', role: 'np', name: '李專師' },
  { id: 'u4', username: 'ph', password: '123', role: 'pharmacist', name: '林藥師' },
];

const INITIAL_LIMITS = {
  kcal: { min: 40, max: 120, unit: 'Kcal/kg' },
  cho: { min: 4, max: 15, unit: 'GIR mg/kg/min' },
  aa: { min: 1, max: 4, unit: 'g/kg' },
  na: { min: 2, max: 5, unit: 'mEq/kg' },
  k: { min: 1, max: 3, unit: 'mEq/kg' },
  cl: { min: 2, max: 5, unit: 'mEq/kg' },
  ca: { min: 1, max: 3, unit: 'mEq/kg' },
  p: { min: 1, max: 2, unit: 'mmol/kg' },
  mg: { min: 0.2, max: 0.5, unit: 'mEq/kg' },
};

const INITIAL_PACKAGES = [
  { code: 'P01', name: 'Preterm Standard A', kcal: 400, cho: 100, aa: 25, na: 30, k: 20, cl: 30, ca: 15, p: 10, mg: 5 },
  { code: 'P02', name: 'Term Standard B', kcal: 500, cho: 120, aa: 30, na: 40, k: 25, cl: 40, ca: 20, p: 15, mg: 5 },
  { code: 'C01', name: 'Custom (自訂)', kcal: 0, cho: 0, aa: 0, na: 0, k: 0, cl: 0, ca: 0, p: 0, mg: 0 },
];

// 元素清單與對應的欄位屬性
const ELEMENTS = [
  { key: 'kcal', label: '熱量', unit1: 'kcal/L', unit2: 'Kcal/kg', isGIR: false },
  { key: 'cho', label: 'CHO', unit1: 'g/L', unit2: 'GIR mg/kg/min', isGIR: true },
  { key: 'aa', label: 'Amino acid', unit1: 'g/L', unit2: 'g/kg', isGIR: false },
  { key: 'na', label: 'Na', unit1: 'mEq/L', unit2: 'mEq/kg', isGIR: false },
  { key: 'k', label: 'K', unit1: 'mEq/L', unit2: 'mEq/kg', isGIR: false },
  { key: 'cl', label: 'Cl', unit1: 'mEq/L', unit2: 'mEq/kg', isGIR: false },
  { key: 'ca', label: 'Ca', unit1: 'mEq/L', unit2: 'mEq/kg', isGIR: false },
  { key: 'p', label: 'P', unit1: 'mmol/L', unit2: 'mmol/kg', isGIR: false },
  { key: 'mg', label: 'Mg', unit1: 'mEq/L', unit2: 'mEq/kg', isGIR: false },
];

// 其他添加清單
const OTHER_ADDITIONS = [
  { key: 'znso4', label: 'ZnSO4', unit: 'mL' },
  { key: 'heparin', label: 'Heparin', unit: 'IU' },
  { key: 'lyo', label: 'Lyo-povigent', unit: 'mL' },
  { key: 'peditrace', label: 'Peditrace', unit: 'mL' }
];

// --- 工具函數 ---
const generateId = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const getAgeInDays = (dob) => {
  const diffTime = Math.abs(new Date() - new Date(dob));
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};
const getTodayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

export default function App() {
  // --- 系統全域狀態 ---
  const [user, setUser] = useState(null);
  const [view, setView] = useState('login'); // login, patients, admissions, orders, orderForm, settings
  const [isSyncing, setIsSyncing] = useState(false); // 控制載入中狀態
  
  // --- 資料庫狀態 (模擬) ---
  const [db, setDb] = useState({
    users: INITIAL_USERS,
    limits: INITIAL_LIMITS,
    packages: INITIAL_PACKAGES,
    patients: [
      { mrn: '0123456', name: '測試嬰', dob: '2026-02-15', gender: '男' }
    ],
    admissions: [
      { encounterId: 'I26020001', mrn: '0123456', adminDate: '2026-02-15', dischargeDate: '', bed: 'NICU01', isClosed: false }
    ],
    orders: []
  });

  // --- UI 導覽狀態 ---
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [selectedAdmission, setSelectedAdmission] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [alertMsg, setAlertMsg] = useState('');

  const showAlert = (msg) => {
    setAlertMsg(msg);
    setTimeout(() => setAlertMsg(''), 3000);
  };

  // ==========================================
  // 【核心】統一的 API 同步處理中心 (API Wrapper)
  // ==========================================
  const apiSync = async (action, table, pk, data, successCallback) => {
    setIsSyncing(true);
    try {
      /* * ====== 未來正式串接 GAS 時，請取消註解這段 ======
       * const response = await fetch(GAS_URL, {
       * method: 'POST',
       * body: JSON.stringify({ action, table, pk, data })
       * });
       * const result = await response.json();
       * if (!result.success) throw new Error(result.error);
       * ===============================================
       */
      
      // 目前模擬網路延遲 300 毫秒
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // 如果 API 呼叫成功，才執行本地的畫面更新 (setDb)
      successCallback();
      
    } catch (error) {
      console.error("API 錯誤:", error);
      showAlert(`連線存檔失敗: ${error.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // --- 登入處理 ---
  const handleLogin = (username, password) => {
    const found = db.users.find(u => u.username === username && u.password === password);
    if (found) {
      setUser(found);
      if (found.role === 'admin') setView('settings');
      else if (found.role === 'pharmacist') setView('globalOrders'); // 藥師直接進入總列表
      else setView('patients');
    } else {
      showAlert('帳號或密碼錯誤');
    }
  };

  // --- 共用 Alert 元件 ---
  const AlertBanner = () => alertMsg && (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded z-50 shadow-lg flex items-center gap-2">
      <AlertTriangle size={18} /> {alertMsg}
    </div>
  );

  // --- 畫面渲染 ---
  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans">
      <AlertBanner />
      
      {/* 導覽列 */}
      {user && (
        <nav className="bg-blue-800 text-white p-4 shadow-md flex justify-between items-center relative">
          <div className="flex items-center gap-2 text-xl font-bold">
            <Syringe /> Neo TPN Order System
            {isSyncing && <span className="text-xs bg-blue-600 px-2 py-1 rounded animate-pulse">連線中...</span>}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm bg-blue-700 px-3 py-1 rounded-full">
              {user.name} ({user.role})
            </span>
            {user.role === 'admin' && (
              <button onClick={() => setView('settings')} className="hover:text-blue-200"><Settings size={20}/></button>
            )}
            <button 
              onClick={() => { setUser(null); setView('login'); }}
              className="hover:text-red-300 text-sm font-semibold"
            >
              登出
            </button>
          </div>
        </nav>
      )}

      {/* 畫面切換 */}
      <main className="p-4 md:p-6 max-w-7xl mx-auto">
        {view === 'login' && <LoginView onLogin={handleLogin} />}
        {view === 'settings' && <SettingsView db={db} setDb={setDb} apiSync={apiSync} showAlert={showAlert} />}
        {view === 'patients' && <PatientsView db={db} setDb={setDb} apiSync={apiSync} showAlert={showAlert} onSelect={(p) => { setSelectedPatient(p); setView('admissions'); }} />}
        {view === 'admissions' && <AdmissionsView db={db} setDb={setDb} apiSync={apiSync} showAlert={showAlert} patient={selectedPatient} onBack={() => setView('patients')} onSelect={(a) => { setSelectedAdmission(a); setView('orders'); }} />}
        {view === 'orders' && <OrdersView db={db} setDb={setDb} apiSync={apiSync} patient={selectedPatient} admission={selectedAdmission} user={user} onBack={() => setView('admissions')} onEdit={(o) => { setEditingOrder(o); setView('orderForm'); }} showAlert={showAlert} />}
        {view === 'globalOrders' && <GlobalOrdersView db={db} user={user} onEdit={(o, p, a) => { setEditingOrder(o); setSelectedPatient(p); setSelectedAdmission(a); setView('orderForm'); }} />}
        {view === 'orderForm' && <OrderFormView db={db} setDb={setDb} apiSync={apiSync} patient={selectedPatient} admission={selectedAdmission} user={user} order={editingOrder} onBack={() => setView(user.role === 'pharmacist' ? 'globalOrders' : 'orders')} showAlert={showAlert} />}
      </main>
    </div>
  );
}

// ==========================================
// 1. 登入畫面
// ==========================================
function LoginView({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md border border-gray-100">
        <div className="flex justify-center mb-6 text-blue-600"><Syringe size={48} /></div>
        <h2 className="text-2xl font-bold text-center mb-6 text-gray-800">新生兒靜脈營養處方系統</h2>
        <form onSubmit={(e) => { e.preventDefault(); onLogin(username, password); }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">帳號</label>
            <div className="relative">
              <User className="absolute left-3 top-3 text-gray-400" size={18} />
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="w-full pl-10 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密碼</label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full pl-10 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
            </div>
          </div>
          <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 font-semibold transition">
            登入系統
          </button>
        </form>
        <div className="mt-4 text-xs text-gray-500 text-center">
          測試帳號：admin/123 (設定), dr/123 (開立), ph/123 (調配)
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 2. 設定畫面 (Admin)
// ==========================================
function SettingsView({ db, setDb, apiSync, showAlert }) {
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'doctor', name: '' });
  
  // 建立一個本地的 limits 狀態，避免打字時一直觸發 API
  const [localLimits, setLocalLimits] = useState(db.limits);

  const handleSaveLimits = () => {
    // 使用統一的 API 處理中心打包傳送
    apiSync('saveRecord', 'limits', null, localLimits, () => {
      setDb(p => ({ ...p, limits: localLimits }));
      showAlert('濃度設定已成功儲存至資料庫！');
    });
  };

  const handleAddUser = () => {
    if (!newUser.username || !newUser.password || !newUser.name) return showAlert('請填寫完整資訊');
    if (db.users.find(u => u.username === newUser.username)) return showAlert('此帳號已存在');
    
    const userToAdd = { id: generateId('u'), ...newUser };
    
    apiSync('saveRecord', 'users', 'id', userToAdd, () => {
      setDb(p => ({ ...p, users: [...p.users, userToAdd] }));
      setNewUser({ username: '', password: '', role: 'doctor', name: '' });
      showAlert('操作者已新增');
    });
  };

  const handleDeleteUser = (id) => {
    const user = db.users.find(u => u.id === id);
    if (user.username === 'admin') return showAlert('無法刪除預設管理員帳號');
    
    if(confirm(`確定要刪除帳號 ${user.username} 嗎？`)) {
      apiSync('deleteRecord', 'users', 'id', { id }, () => {
        setDb(p => ({...p, users: p.users.filter(u => u.id !== id)}));
        showAlert('帳號已刪除');
      });
    }
  };

  const roleLabels = { admin: '管理員', doctor: '醫師', np: '專師', pharmacist: '藥師' };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2"><Settings /> 系統設定</h2>
      
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4 border-b pb-2">
          <h3 className="text-lg font-semibold">濃度上下限設定</h3>
          <button onClick={handleSaveLimits} className="bg-green-600 text-white px-4 py-1.5 rounded hover:bg-green-700 flex items-center gap-2 font-medium">
            <CloudUpload size={18}/> 儲存濃度設定至資料庫
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(localLimits).map(([key, limit]) => {
            const elementLabel = ELEMENTS.find(e => e.key === key)?.label || key.toUpperCase();
            return (
            <div key={key} className="p-3 border rounded bg-gray-50 flex flex-col gap-2">
              <span className="font-medium text-blue-800">{elementLabel} <span className="text-xs text-gray-500">({limit.unit})</span></span>
              <div className="flex items-center gap-2">
                <input type="number" step="0.1" value={limit.min} onChange={e => setLocalLimits(p => ({...p, [key]: {...limit, min: Number(e.target.value)}}))} className="w-20 p-1 border rounded text-sm focus:ring-2 focus:ring-green-400" />
                <span>~</span>
                <input type="number" step="0.1" value={limit.max} onChange={e => setLocalLimits(p => ({...p, [key]: {...limit, max: Number(e.target.value)}}))} className="w-20 p-1 border rounded text-sm focus:ring-2 focus:ring-green-400" />
              </div>
            </div>
          )})}
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-4 border-b pb-2 flex items-center gap-2"><Users size={20}/> 操作者管理</h3>
        
        {/* 新增操作者表單 */}
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 flex gap-4 items-end flex-wrap mb-6">
          <div>
            <label className="block text-xs text-gray-600 mb-1">帳號</label>
            <input type="text" value={newUser.username} onChange={e=>setNewUser({...newUser, username: e.target.value})} className="border p-2 rounded w-32" placeholder="登入帳號" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">密碼</label>
            <input type="text" value={newUser.password} onChange={e=>setNewUser({...newUser, password: e.target.value})} className="border p-2 rounded w-32" placeholder="登入密碼" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">顯示名稱</label>
            <input type="text" value={newUser.name} onChange={e=>setNewUser({...newUser, name: e.target.value})} className="border p-2 rounded w-32" placeholder="如: 陳醫師" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">身份</label>
            <select value={newUser.role} onChange={e=>setNewUser({...newUser, role: e.target.value})} className="border p-2 rounded w-32 bg-white">
              <option value="doctor">醫師</option>
              <option value="np">專師</option>
              <option value="pharmacist">藥師</option>
              <option value="admin">管理員</option>
            </select>
          </div>
          <button onClick={handleAddUser} className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 flex items-center gap-2 font-semibold shadow-sm">
            <Plus size={18}/> 新增操作者
          </button>
        </div>

        {/* 操作者列表 */}
        <div className="bg-white rounded border overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-3 border-b">帳號</th>
                <th className="p-3 border-b">密碼</th>
                <th className="p-3 border-b">顯示名稱</th>
                <th className="p-3 border-b">身份</th>
                <th className="p-3 border-b text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {db.users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50 transition">
                  <td className="p-3 font-medium text-gray-800">{u.username}</td>
                  <td className="p-3 text-gray-500 font-mono text-xs">{u.password}</td>
                  <td className="p-3 text-gray-800">{u.name}</td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                      u.role === 'admin' ? 'bg-red-100 text-red-700' : 
                      u.role === 'pharmacist' ? 'bg-green-100 text-green-700' : 
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {roleLabels[u.role] || u.role}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    {u.username !== 'admin' && (
                      <button onClick={() => handleDeleteUser(u.id)} className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition" title="刪除帳號">
                        <Trash2 size={16}/>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 3. 病人列表畫面
// ==========================================
function PatientsView({ db, apiSync, setDb, showAlert, onSelect }) {
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newPt, setNewPt] = useState({ mrn: '', name: '', dob: '', gender: '男' });

  const filtered = db.patients.filter(p => p.mrn.includes(search) || p.name.includes(search));

  const handleSave = () => {
    if(newPt.mrn.length < 1 || newPt.mrn.length > 7) return showAlert('病歷號須為7碼內');
    if(db.patients.find(p => p.mrn === newPt.mrn)) return showAlert('病歷號已存在');
    
    // 透過 API Sync 處理
    apiSync('saveRecord', 'patients', 'mrn', newPt, () => {
      // 順利更新本地狀態
      if (setDb) setDb(p => ({ ...p, patients: [...p.patients, newPt] }));
      setShowNew(false);
      setNewPt({ mrn: '', name: '', dob: '', gender: '男' });
      showAlert('病人資料已成功建立！');
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow">
        <div className="relative w-64">
          <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
          <input type="text" placeholder="搜尋病歷號或姓名..." value={search} onChange={e=>setSearch(e.target.value)} className="pl-10 pr-3 py-2 border rounded-md w-full" />
        </div>
        <button onClick={() => setShowNew(true)} className="bg-blue-600 text-white px-4 py-2 rounded-md flex items-center gap-2 hover:bg-blue-700">
          <Plus size={18} /> 建立新病人
        </button>
      </div>

      {showNew && (
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 flex gap-4 items-end flex-wrap">
          <div><label className="block text-xs text-gray-600">病歷號 (7碼)</label><input type="text" value={newPt.mrn} onChange={e=>setNewPt({...newPt, mrn: e.target.value})} className="border p-2 rounded w-32" maxLength={7} /></div>
          <div><label className="block text-xs text-gray-600">姓名</label><input type="text" value={newPt.name} onChange={e=>setNewPt({...newPt, name: e.target.value})} className="border p-2 rounded w-32" maxLength={6} /></div>
          <div><label className="block text-xs text-gray-600">生日</label><input type="date" value={newPt.dob} onChange={e=>setNewPt({...newPt, dob: e.target.value})} className="border p-2 rounded w-40" /></div>
          <div><label className="block text-xs text-gray-600">性別</label>
            <select value={newPt.gender} onChange={e=>setNewPt({...newPt, gender: e.target.value})} className="border p-2 rounded w-20">
              <option>男</option><option>女</option>
            </select>
          </div>
          {/* 【修正】將 handleSave 替換成包含 API 與本地更新的邏輯 */}
          <button onClick={handleSave} className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"><Save size={18}/></button>
          <button onClick={() => setShowNew(false)} className="text-gray-500 px-2">取消</button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-100">
            <tr><th className="p-3">病歷號</th><th className="p-3">姓名</th><th className="p-3">性別</th><th className="p-3">出生日期</th><th className="p-3">操作</th></tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.mrn} className="border-b hover:bg-gray-50">
                <td className="p-3 font-medium">{p.mrn}</td><td className="p-3">{p.name}</td><td className="p-3">{p.gender}</td><td className="p-3">{p.dob}</td>
                <td className="p-3"><button onClick={() => onSelect(p)} className="text-blue-600 font-semibold hover:underline">選擇就醫序號 &rarr;</button></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan="5" className="p-4 text-center text-gray-500">查無資料</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 為了讓 PatientsView, AdmissionsView 等能順利更新本地狀態，我們需要在宣告時把 setDb 傳給它們
// 在 App 元件內已確保都有傳入

// ==========================================
// 4. 就醫序號列表畫面
// ==========================================
function AdmissionsView({ db, apiSync, setDb, showAlert, patient, onBack, onSelect }) {
  const [showNew, setShowNew] = useState(false);
  const [newAdm, setNewAdm] = useState({ encounterId: '', adminDate: '', dischargeDate: '', bed: '', isClosed: false });
  const [editingAdm, setEditingAdm] = useState(null); 

  const admissions = db.admissions.filter(a => a.mrn === patient.mrn);

  const handleSave = () => {
    if(!newAdm.encounterId || !newAdm.adminDate || !newAdm.bed) return showAlert('請填寫必填欄位');
    
    const recordToSave = { ...newAdm, mrn: patient.mrn };
    apiSync('saveRecord', 'admissions', 'encounterId', recordToSave, () => {
      // API 成功後，更新本地畫面
      if(setDb) setDb(p => ({ ...p, admissions: [...p.admissions, recordToSave] }));
      setShowNew(false);
      setNewAdm({ encounterId: '', adminDate: '', dischargeDate: '', bed: '', isClosed: false });
    });
  };

  const handleUpdate = () => {
    if(!editingAdm.adminDate || !editingAdm.bed) return showAlert('請填寫必填欄位');
    
    apiSync('saveRecord', 'admissions', 'encounterId', editingAdm, () => {
      if(setDb) setDb(p => ({
        ...p,
        admissions: p.admissions.map(a => a.encounterId === editingAdm.encounterId ? editingAdm : a)
      }));
      setEditingAdm(null);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 mb-4">
        <button onClick={onBack} className="p-2 hover:bg-gray-200 rounded-full"><ArrowLeft size={20}/></button>
        <h2 className="text-xl font-bold">就醫序號 - {patient.name} ({patient.mrn})</h2>
      </div>

      <div className="bg-white p-4 rounded-lg shadow flex justify-between items-center">
        <span className="text-gray-600">共 {admissions.length} 筆紀錄</span>
        <button onClick={() => { setShowNew(true); setEditingAdm(null); }} className="bg-blue-600 text-white px-4 py-2 rounded-md flex items-center gap-2 hover:bg-blue-700">
          <Plus size={18} /> 建立新就醫序號
        </button>
      </div>

      {/* 新增表單 */}
      {showNew && (
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 flex gap-4 items-end flex-wrap">
          <div><label className="block text-xs text-gray-600">* 就醫序號 (9碼)</label><input type="text" value={newAdm.encounterId} onChange={e=>setNewAdm({...newAdm, encounterId: e.target.value})} className="border p-2 rounded w-32" maxLength={9} /></div>
          <div><label className="block text-xs text-gray-600">* 入院日期</label><input type="date" value={newAdm.adminDate} onChange={e=>setNewAdm({...newAdm, adminDate: e.target.value})} className="border p-2 rounded w-40" /></div>
          <div><label className="block text-xs text-gray-600">出院日期</label><input type="date" value={newAdm.dischargeDate} onChange={e=>setNewAdm({...newAdm, dischargeDate: e.target.value})} className="border p-2 rounded w-40" /></div>
          <div><label className="block text-xs text-gray-600">* 床號 (6碼)</label><input type="text" value={newAdm.bed} onChange={e=>setNewAdm({...newAdm, bed: e.target.value})} className="border p-2 rounded w-24" maxLength={6} /></div>
          <button onClick={handleSave} className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"><Save size={18}/></button>
          <button onClick={() => setShowNew(false)} className="text-gray-500 px-2">取消</button>
        </div>
      )}

      {/* 編輯表單 */}
      {editingAdm && (
        <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-300 flex gap-4 items-end flex-wrap shadow-inner">
          <div><label className="block text-xs text-gray-600">就醫序號 (不可改)</label><input type="text" value={editingAdm.encounterId} disabled className="border p-2 rounded w-32 bg-gray-100 text-gray-500 font-bold" /></div>
          <div><label className="block text-xs text-gray-600">* 入院日期</label><input type="date" value={editingAdm.adminDate} onChange={e=>setEditingAdm({...editingAdm, adminDate: e.target.value})} className="border p-2 rounded w-40 focus:ring-2 focus:ring-yellow-400" /></div>
          <div><label className="block text-xs text-gray-600">出院日期</label><input type="date" value={editingAdm.dischargeDate} onChange={e=>setEditingAdm({...editingAdm, dischargeDate: e.target.value})} className="border p-2 rounded w-40 focus:ring-2 focus:ring-yellow-400" /></div>
          <div><label className="block text-xs text-gray-600">* 床號 (6碼)</label><input type="text" value={editingAdm.bed} onChange={e=>setEditingAdm({...editingAdm, bed: e.target.value})} className="border p-2 rounded w-24 focus:ring-2 focus:ring-yellow-400" maxLength={6} /></div>
          <div>
            <label className="block text-xs text-gray-600">狀態</label>
            <select value={editingAdm.isClosed ? 'true' : 'false'} onChange={e=>setEditingAdm({...editingAdm, isClosed: e.target.value === 'true'})} className="border p-2 rounded w-24 bg-white focus:ring-2 focus:ring-yellow-400">
              <option value="false">住院中</option>
              <option value="true">已結案</option>
            </select>
          </div>
          <button onClick={handleUpdate} className="bg-yellow-600 text-white px-4 py-2 rounded hover:bg-yellow-700 flex items-center gap-1 font-semibold"><Save size={18}/> 儲存修改</button>
          <button onClick={() => setEditingAdm(null)} className="text-gray-500 px-2">取消</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {admissions.map(a => (
          <div key={a.encounterId} className={`p-4 rounded-lg border-2 cursor-pointer transition ${a.isClosed ? 'bg-gray-100 border-gray-200' : 'bg-white border-blue-200 hover:border-blue-400 shadow-sm hover:shadow'}`} onClick={() => onSelect(a)}>
            <div className="flex justify-between mb-2 items-center">
              <span className="font-bold text-lg text-blue-800">{a.encounterId}</span>
              <div className="flex items-center gap-2">
                {a.isClosed ? <span className="bg-gray-300 text-gray-700 px-2 py-1 text-xs rounded font-semibold">已結案</span> : <span className="bg-green-100 text-green-700 px-2 py-1 text-xs rounded font-semibold">住院中</span>}
                <button 
                  onClick={(e) => { e.stopPropagation(); setEditingAdm(a); setShowNew(false); }} 
                  className="p-1.5 text-gray-400 hover:text-yellow-600 hover:bg-yellow-100 rounded transition" 
                  title="編輯就醫序號"
                >
                  <Edit size={16} />
                </button>
              </div>
            </div>
            <div className="text-sm text-gray-600 space-y-1">
              <p>床號：<span className="font-medium text-gray-800">{a.bed}</span></p>
              <p>入院：{a.adminDate} {a.dischargeDate && `~ 出院：${a.dischargeDate}`}</p>
            </div>
          </div>
        ))}
        {admissions.length === 0 && <div className="col-span-2 p-8 text-center text-gray-500 bg-white rounded shadow">此病人目前無就醫序號，請先建立。</div>}
      </div>
    </div>
  );
}

// ==========================================
// 5. 處方列表畫面
// ==========================================
function OrdersView({ db, apiSync, setDb, patient, admission, user, onBack, onEdit, showAlert }) {
  const encounterOrders = db.orders.filter(o => o.encounterId === admission.encounterId);
  
  // 狀態顏色對應
  const statusColors = {
    'Draft': 'bg-gray-100 text-gray-800 border-gray-300',
    'Submitted': 'bg-blue-100 text-blue-800 border-blue-300',
    'Dispensed': 'bg-green-100 text-green-800 border-green-300',
    'Void': 'bg-red-50 text-red-600 border-red-200 line-through',
    'Deleted': 'bg-gray-50 text-gray-400 border-gray-200'
  };

  // 排序：最新的在上面
  const sortedOrders = [...encounterOrders].sort((a, b) => new Date(b.date) - new Date(a.date));

  const handleCreateNew = () => {
    if (['doctor', 'np'].includes(user.role)) {
      onEdit(null); // Null 表示新增
    } else {
      showAlert('僅醫師或專科護理師可開立新處方');
    }
  };

  // 時間格式化工具：將 ISO 時間轉為 YYYY/M/D HH:mm
  const formatDateTime = (isoString) => {
    if (!isoString) return '';
    const d = new Date(isoString);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // 處方開始時間格式化工具：將 YYYY-MM-DD 與 HH:mm 組合為 YYYY/M/D HH:mm
  const formatStartDate = (dateStr, timeStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return `${dateStr} ${timeStr || ''}`;
    return `${parts[0]}/${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)} ${timeStr || ''}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-200 rounded-full"><ArrowLeft size={20}/></button>
          <div>
            <h2 className="text-xl font-bold">TPN 處方列表</h2>
            <p className="text-sm text-gray-600">{patient.name} ({patient.mrn}) | 就醫序號: {admission.encounterId} | 床號: {admission.bed}</p>
          </div>
        </div>
        <button onClick={handleCreateNew} className="bg-blue-600 text-white px-4 py-2 rounded-md flex items-center gap-2 hover:bg-blue-700 shadow">
          <FileText size={18} /> 新開 TPN 處方
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-100 border-b">
            <tr>
              <th className="p-3">處方編號 (版次)</th>
              <th className="p-3">狀態</th>
              <th className="p-3">姓名</th>
              <th className="p-3">開立時間</th>
              <th className="p-3">處方開始時間</th>
              <th className="p-3">給藥體積</th>
              <th className="p-3">熱量</th>
              <th className="p-3">開立者</th>
              <th className="p-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {sortedOrders.map(o => (
              <tr key={o.orderId} className="border-b hover:bg-gray-50 transition">
                <td className="p-3 font-mono">
                  {o.orderId} <span className="text-xs text-blue-600 font-bold bg-blue-50 px-1 rounded">v{o.version}</span>
                </td>
                <td className="p-3">
                  <span className={`px-2 py-1 rounded text-xs border ${statusColors[o.status]}`}>
                    {o.status === 'Submitted' ? '醫師完成' : o.status === 'Dispensed' ? '已調配' : o.status === 'Draft' ? '暫存' : o.status === 'Void' ? '已作廢(被取代)' : '已刪除'}
                  </span>
                </td>
                <td className="p-3 font-medium text-gray-800">{patient.name}</td>
                <td className="p-3 text-gray-600">{formatDateTime(o.date)}</td>
                <td className="p-3 text-gray-600">{formatStartDate(o.startDate, o.startTime)}</td>
                <td className="p-3">{Number(o.calcAdminVol).toFixed(0)} mL</td>
                <td className="p-3">{o.elements.kcal?.dose?.toFixed(1)} Kcal/kg</td>
                <td className="p-3">{o.authorName}</td>
                <td className="p-3">
                  <button onClick={() => onEdit(o)} className="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1">
                    {o.status === 'Draft' ? <><Edit size={16}/> 編輯</> : <><Search size={16}/> 檢視 / 修改</>}
                  </button>
                </td>
              </tr>
            ))}
            {sortedOrders.length === 0 && <tr><td colSpan="9" className="p-8 text-center text-gray-500">尚無處方紀錄</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==========================================
// 5.5 全局處方列表畫面 (藥師專用)
// ==========================================
function GlobalOrdersView({ db, user, onEdit }) {
  // 狀態顏色對應
  const statusColors = {
    'Draft': 'bg-gray-100 text-gray-800 border-gray-300',
    'Submitted': 'bg-blue-100 text-blue-800 border-blue-300',
    'Dispensed': 'bg-green-100 text-green-800 border-green-300',
    'Void': 'bg-red-50 text-red-600 border-red-200 line-through',
    'Deleted': 'bg-gray-50 text-gray-400 border-gray-200'
  };

  // 抓取所有處方，並反查對應的病人與就醫序號
  const sortedOrders = db.orders.map(o => {
    const admission = db.admissions.find(a => a.encounterId === o.encounterId);
    const patient = admission ? db.patients.find(p => p.mrn === admission.mrn) : { name: '未知', mrn: '未知' };
    return { ...o, patient, admission };
  }).sort((a, b) => new Date(b.date) - new Date(a.date));

  const formatDateTime = (isoString) => {
    if (!isoString) return '';
    const d = new Date(isoString);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const formatStartDate = (dateStr, timeStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return `${dateStr} ${timeStr || ''}`;
    return `${parts[0]}/${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)} ${timeStr || ''}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-blue-800 flex items-center gap-2">
          <Syringe size={24} /> 所有病人 TPN 處方列表 (藥局端)
        </h2>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-100 border-b">
            <tr>
              <th className="p-3">處方編號 (版次)</th>
              <th className="p-3">狀態</th>
              <th className="p-3">姓名</th>
              <th className="p-3">開立時間</th>
              <th className="p-3">處方開始時間</th>
              <th className="p-3">給藥體積</th>
              <th className="p-3">熱量</th>
              <th className="p-3">開立者</th>
              <th className="p-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {sortedOrders.map(o => (
              <tr key={o.orderId} className="border-b hover:bg-gray-50 transition">
                <td className="p-3 font-mono">
                  {o.orderId} <span className="text-xs text-blue-600 font-bold bg-blue-50 px-1 rounded">v{o.version}</span>
                </td>
                <td className="p-3">
                  <span className={`px-2 py-1 rounded text-xs border ${statusColors[o.status]}`}>
                    {o.status === 'Submitted' ? '醫師完成' : o.status === 'Dispensed' ? '已調配' : o.status === 'Draft' ? '暫存' : o.status === 'Void' ? '已作廢(被取代)' : '已刪除'}
                  </span>
                </td>
                <td className="p-3 font-medium text-gray-800">{o.patient.name}</td>
                <td className="p-3 text-gray-600">{formatDateTime(o.date)}</td>
                <td className="p-3 text-gray-600">{formatStartDate(o.startDate, o.startTime)}</td>
                <td className="p-3">{Number(o.calcAdminVol).toFixed(0)} mL</td>
                <td className="p-3">{o.elements.kcal?.dose?.toFixed(1)} Kcal/kg</td>
                <td className="p-3">{o.authorName}</td>
                <td className="p-3">
                  <button onClick={() => onEdit(o, o.patient, o.admission)} className="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1">
                    <Search size={16}/> 檢視 / 調配
                  </button>
                </td>
              </tr>
            ))}
            {sortedOrders.length === 0 && <tr><td colSpan="9" className="p-8 text-center text-gray-500">尚無處方紀錄</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==========================================
// 6. 處方開立/編輯表單核心邏輯
// ==========================================
function OrderFormView({ db, setDb, apiSync, patient, admission, user, order, onBack, showAlert }) {
  // --- 表單狀態初始化 ---
  const [formData, setFormData] = useState(() => {
    if (order) {
      // 深度複製避免改到原始 state
      const parsed = JSON.parse(JSON.stringify(order));
      // 兼容舊資料，若無 otherAdditions 則補上
      if (!parsed.otherAdditions) {
        parsed.otherAdditions = { znso4: '', heparin: '', lyo: '', peditrace: '' };
      }
      // 兼容舊資料，補上日期與天數
      if (!parsed.startDate) parsed.startDate = getTodayLocal();
      if (!parsed.startTime) parsed.startTime = '17:00';
      if (!parsed.durationDays) parsed.durationDays = 1;

      return parsed;
    }
    // 新增處方預設值
    return {
      orderId: generateId('TPN'),
      groupId: generateId('G'),
      version: 1,
      status: 'Draft', // 預設暫存
      encounterId: admission.encounterId,
      date: new Date().toISOString(),
      authorId: user.id,
      authorName: user.name,
      parentOrderId: null, // 用於追蹤是由哪張單升級上來的
      
      // Step 1
      weight: '',
      height: '',
      
      // Step 2
      startDate: getTodayLocal(),
      startTime: '17:00',
      durationDays: 1, // 預設 1 天
      packageCode: '',
      prepVol: '',
      rate: '',
      calcAdminVol: 0,
      
      // Step 3 (結構: { kcal: { conc, dose, remark }, cho: {...} })
      elements: ELEMENTS.reduce((acc, el) => {
        acc[el.key] = { conc: 0, dose: 0, remark: '' };
        return acc;
      }, {}),

      // Step 4 其他添加
      otherAdditions: {
        znso4: '',
        heparin: '',
        lyo: '',
        peditrace: ''
      }
    };
  });

  // 判斷是否為「檢視」狀態 (不可改欄位)
  // 改為判定 formData 的狀態：當點選「修改產生新版」後，formData.status 會轉為 Draft，即可解鎖編輯與存檔
  const isReadOnly = formData.status !== 'Draft';

  const [validationErrors, setValidationErrors] = useState({});

  // 輔助變數
  const ageDays = getAgeInDays(patient.dob);
  const selectedPkg = db.packages.find(p => p.code === formData.packageCode);

  // =====================================
  // 計算邏輯區
  // =====================================

  // 當 Rate 改變時，自動計算 Admin Vol
  useEffect(() => {
    const vol = parseFloat(formData.rate) * 24;
    setFormData(prev => ({ ...prev, calcAdminVol: isNaN(vol) ? 0 : vol }));
  }, [formData.rate]);

  // 當體重或給藥體積改變時，以「當前各自獨立的配方濃度 (conc)」正向重算所有的「劑量/體重 (dose)」
  useEffect(() => {
    if (!isReadOnly && formData.weight && formData.calcAdminVol) {
      setFormData(prev => {
        const volL = prev.calcAdminVol / 1000;
        const wt = parseFloat(prev.weight);
        const newElements = { ...prev.elements };
        
        let hasChanges = false;

        ELEMENTS.forEach(el => {
          const concVal = prev.elements[el.key].conc; // 鎖定目前各成分的配方濃度
          let doseVal = 0;

          if (el.isGIR) {
            const gPerKg = (concVal * volL) / wt;
            doseVal = gPerKg * (1000 / 1440);
          } else {
            doseVal = (concVal * volL) / wt;
          }

          // 避免浮點數誤差導致不必要的渲染
          if (Math.abs(Number(newElements[el.key].dose) - doseVal) > 0.0001) {
            newElements[el.key] = { ...newElements[el.key], dose: doseVal };
            hasChanges = true;
          }
        });

        return hasChanges ? { ...prev, elements: newElements } : prev;
      });
    }
  }, [formData.weight, formData.calcAdminVol]);

  // 處理下拉選單切換套裝
  const handlePackageChange = (e) => {
    const newPkgCode = e.target.value;
    
    setFormData(prev => {
      const newState = { ...prev, packageCode: newPkgCode };
      
      // 只有當使用者"主動選擇"非自訂的標準套裝時，才批次覆寫所有成分濃度
      if (newPkgCode && newPkgCode !== 'C01') {
        const pkg = db.packages.find(p => p.code === newPkgCode);
        const newElements = { ...prev.elements };
        
        const volL = prev.calcAdminVol ? prev.calcAdminVol / 1000 : 0;
        const wt = prev.weight ? parseFloat(prev.weight) : 0;

        ELEMENTS.forEach(el => {
          const concVal = pkg[el.key] || 0;
          let doseVal = 0;

          if (volL > 0 && wt > 0) {
            if (el.isGIR) {
              const gPerKg = (concVal * volL) / wt;
              doseVal = gPerKg * (1000 / 1440);
            } else {
              doseVal = (concVal * volL) / wt;
            }
          }

          newElements[el.key] = { ...newElements[el.key], conc: concVal, dose: doseVal };
        });
        newState.elements = newElements;
      }
      return newState;
    });
  };

  // 反向計算 (使用者手動改 Dose)
  const handleDoseChange = (key, newDoseStr) => {
    if (key === 'kcal') return; // 熱量為衍生計算值，不直接反算

    const newDose = parseFloat(newDoseStr);
    const wt = parseFloat(formData.weight);
    const volL = formData.calcAdminVol / 1000;

    if (isNaN(newDose) || !wt || !volL) {
      // 若資料不足，只更新輸入值
      setFormData(prev => ({
        ...prev,
        elements: { ...prev.elements, [key]: { ...prev.elements[key], dose: newDoseStr } }
      }));
      return;
    }

    let newConc = 0;
    const isGIR = ELEMENTS.find(e => e.key === key).isGIR;

    if (isGIR) {
      // 反推 CHO g/L: 
      // g/kg = GIR * 1440 / 1000
      // 總 g = g/kg * wt
      // g/L = 總 g / volL
      const gPerKg = newDose * (1440 / 1000);
      newConc = (gPerKg * wt) / volL;
    } else {
      // 反推 一般 conc/L:
      // 總量 = dose * wt
      // conc/L = 總量 / volL
      newConc = (newDose * wt) / volL;
    }

    setFormData(prev => {
      const newElements = {
        ...prev.elements,
        [key]: { ...prev.elements[key], dose: newDose, conc: newConc }
      };

      // 【新增】熱量自動連動計算：CHO(g/L)*3.4 + AA(g/L)*4
      if (key === 'cho' || key === 'aa') {
        const choConc = key === 'cho' ? newConc : prev.elements.cho.conc;
        const aaConc = key === 'aa' ? newConc : prev.elements.aa.conc;
        
        const newKcalConc = (choConc * 3.4) + (aaConc * 4);
        const newKcalDose = (newKcalConc * volL) / wt;
        
        newElements.kcal = {
          ...newElements.kcal,
          conc: newKcalConc,
          dose: newKcalDose
        };
      }

      return {
        ...prev,
        packageCode: 'C01', // 一旦手動改，套裝就變成自訂
        elements: newElements
      };
    });
  };

  // =====================================
  // 驗證與存檔流程
  // =====================================
  const validateOrder = () => {
    // 1. 檢查必填欄位 (新增 formData.prepVol)
    if (!formData.weight || !formData.height || !formData.rate || !formData.packageCode || !formData.startDate || !formData.startTime || !formData.prepVol) {
      showAlert('請填寫所有必填欄位 (身高、體重、速率、調配體積、處方套餐、處方開始時間)');
      return false;
    }
    
    // 2. 稽核：調配體積必須大於系統計算的給藥體積
    const prepVolNum = parseFloat(formData.prepVol);
    if (isNaN(prepVolNum) || prepVolNum <= formData.calcAdminVol) {
      showAlert(`調配體積 (${prepVolNum} mL) 必須大於 給藥體積 (${formData.calcAdminVol.toFixed(1)} mL)`);
      return false;
    }

    // 3. 檢查元素濃度上下限
    const errors = {};
    ELEMENTS.forEach(el => {
      const dose = formData.elements[el.key].dose;
      const limit = db.limits[el.key];
      if (dose < limit.min || dose > limit.max) {
        errors[el.key] = `超出範圍 (${limit.min}~${limit.max})`;
      }
    });
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) {
      showAlert('部分劑量超出安全範圍，請修正後再提交');
      return false;
    }
    return true;
  };

  const saveOrder = (newStatus) => {
    if (newStatus === 'Submitted' && !validateOrder()) return;

    let finalOrder = { ...formData, status: newStatus, date: new Date().toISOString() };

    // 透過統一 API 存檔
    apiSync('saveRecord', 'orders', 'orderId', finalOrder, () => {
      if(setDb) {
        setDb(prev => {
          let newOrders = [...prev.orders];
          
          // SOP: 如果這次存檔是把 Draft 變成 Submitted，且有 parentOrderId (代表是修改而來的)
          // 必須把舊版 (parentOrderId) 的狀態改成 Void
          if (newStatus === 'Submitted' && finalOrder.parentOrderId) {
            newOrders = newOrders.map(o => 
              o.orderId === finalOrder.parentOrderId ? { ...o, status: 'Void' } : o
            );
          }

          // 更新或新增目前這筆
          const existingIdx = newOrders.findIndex(o => o.orderId === finalOrder.orderId);
          if (existingIdx >= 0) {
            newOrders[existingIdx] = finalOrder;
          } else {
            newOrders.push(finalOrder);
          }

          return { ...prev, orders: newOrders };
        });
      }
      onBack();
    });
  };

  // SOP: 醫師修改已提交的處方
  const handleRevise = () => {
    if (formData.status === 'Dispensed') {
      showAlert('藥師已調配，禁止直接修改！請聯繫藥局。');
      return;
    }
    // 複製資料，升級 Version，產生新 OrderID，進入 Draft 狀態
    setFormData(prev => ({
      ...prev,
      orderId: generateId('TPN'), // 新的唯一碼
      version: prev.version + 1,
      status: 'Draft',
      parentOrderId: prev.orderId, // 記錄要取代的舊版
      date: new Date().toISOString()
    }));
  };

  // SOP: 刪除暫存
  const handleDelete = () => {
    if (confirm('確定要刪除此暫存處方嗎？')) {
      // 這裡採用狀態修改為 Deleted
      const deletedOrder = { ...formData, status: 'Deleted' };
      apiSync('saveRecord', 'orders', 'orderId', deletedOrder, () => {
        if(setDb) setDb(prev => ({
          ...prev,
          orders: prev.orders.map(o => o.orderId === formData.orderId ? { ...o, status: 'Deleted' } : o)
        }));
        onBack();
      });
    }
  };

  // SOP: 藥師調配
  const handleDispense = () => {
    if (user.role !== 'pharmacist') {
      showAlert('僅藥師權限可執行調配確認');
      return;
    }
    saveOrder('Dispensed');
  };

  // =====================================
  // UI 渲染
  // =====================================
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* 標頭與狀態列 */}
      <div className="bg-white p-4 rounded-lg shadow flex flex-wrap justify-between items-center border-t-4 border-blue-600">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full"><ArrowLeft size={20}/></button>
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              TPN 處方單 
              <span className="text-sm font-mono bg-gray-100 px-2 py-1 rounded border">
                {formData.orderId} (v{formData.version})
              </span>
            </h2>
            <div className="text-sm text-gray-500 mt-1 flex gap-4">
              <span>群組: {formData.groupId}</span>
              {formData.parentOrderId && <span>修改自: {formData.parentOrderId}</span>}
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <span className="font-bold mr-2">狀態:</span>
          {formData.status === 'Draft' && <span className="bg-gray-200 text-gray-800 px-3 py-1 rounded-full text-sm font-bold">暫存編輯中</span>}
          {formData.status === 'Submitted' && <span className="bg-blue-200 text-blue-800 px-3 py-1 rounded-full text-sm font-bold flex items-center gap-1"><CheckCircle size={16}/> 醫師完成</span>}
          {formData.status === 'Dispensed' && <span className="bg-green-200 text-green-800 px-3 py-1 rounded-full text-sm font-bold flex items-center gap-1"><CheckCircle size={16}/> 藥師已調配</span>}
          {formData.status === 'Void' && <span className="bg-red-200 text-red-800 px-3 py-1 rounded-full text-sm font-bold line-through">已作廢</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* 左側：Step 1 & 2 */}
        <div className="space-y-6">
          {/* Step 1 */}
          <div className="bg-white p-5 rounded-lg shadow border border-gray-100">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-blue-800 border-b pb-2">
              <span className="bg-blue-600 text-white w-6 h-6 rounded-full inline-flex justify-center items-center text-sm">1</span> 
              基本資料
            </h3>
            <div className="grid grid-cols-2 gap-y-3 text-sm">
              <div className="text-gray-500">病歷號</div><div className="font-semibold">{patient.mrn}</div>
              <div className="text-gray-500">姓名/性別</div><div className="font-semibold">{patient.name} / {patient.gender}</div>
              <div className="text-gray-500">日齡</div><div className="font-semibold">{ageDays} 天</div>
              <div className="text-gray-500">就醫序號/床號</div><div className="font-semibold">{admission.encounterId} / {admission.bed}</div>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">體重 (kg) <span className="text-red-500">*</span></label>
                <input type="number" step="0.001" value={formData.weight} onChange={e=>setFormData({...formData, weight: e.target.value})} disabled={isReadOnly} className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100" placeholder="e.g. 2.150" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">身高 (cm) <span className="text-red-500">*</span></label>
                <input type="number" step="0.1" value={formData.height} onChange={e=>setFormData({...formData, height: e.target.value})} disabled={isReadOnly} className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100" placeholder="e.g. 45.5" />
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div className="bg-white p-5 rounded-lg shadow border border-gray-100">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-blue-800 border-b pb-2">
              <span className="bg-blue-600 text-white w-6 h-6 rounded-full inline-flex justify-center items-center text-sm">2</span> 
              選擇標準處方
            </h3>
            <div className="space-y-4">
              {/* 取消 xl:flex-row，改為永遠上下排列 flex-col，避免在較小螢幕被擠壓 */}
              <div className="flex flex-col gap-3 bg-gray-50 p-3 rounded border border-gray-200">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">處方開始時間 <span className="text-red-500">*</span></label>
                  <div className="flex gap-2">
                    <input type="date" value={formData.startDate} onChange={e=>setFormData({...formData, startDate: e.target.value})} disabled={isReadOnly} className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 disabled:bg-transparent disabled:font-bold" />
                    {/* 加入 shrink-0 避免時間輸入框被壓縮 */}
                    <input 
                      type="text" 
                      maxLength="5"
                      placeholder="HH:mm"
                      value={formData.startTime} 
                      onChange={e => {
                        let val = e.target.value.replace(/[^\d:]/g, ''); // 只能輸入數字和冒號
                        // 如果輸入到第2個字且沒有冒號，而且是正在新增字元，就自動補上冒號
                        if (val.length === 2 && !val.includes(':') && formData.startTime.length < val.length) {
                          val += ':';
                        }
                        setFormData({...formData, startTime: val});
                      }} 
                      disabled={isReadOnly} 
                      className="w-24 shrink-0 border p-2 rounded focus:ring-2 focus:ring-blue-500 disabled:bg-transparent disabled:font-bold text-center" 
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">處方天數 <span className="text-red-500">*</span></label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={formData.durationDays === 1} onChange={() => setFormData({...formData, durationDays: 1})} disabled={isReadOnly} className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500" />
                      {/* 加入 whitespace-nowrap 避免文字被擠壓成兩行 */}
                      <span className="text-sm font-medium text-gray-700 whitespace-nowrap">1 天</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={formData.durationDays === 2} onChange={() => setFormData({...formData, durationDays: 2})} disabled={isReadOnly} className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500" />
                      {/* 加入 whitespace-nowrap 避免文字被擠壓成兩行 */}
                      <span className="text-sm font-medium text-gray-700 whitespace-nowrap">2 天</span>
                    </label>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">標準處方套餐 <span className="text-red-500">*</span></label>
                <select value={formData.packageCode} onChange={handlePackageChange} disabled={isReadOnly} className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100">
                  <option value="">-- 請選擇 --</option>
                  {db.packages.map(p => <option key={p.code} value={p.code}>{p.code} - {p.name}</option>)}
                </select>
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-bold text-gray-700 mb-1">調配體積 (mL) <span className="text-red-500">*</span></label>
                  <input type="number" value={formData.prepVol} onChange={e=>setFormData({...formData, prepVol: e.target.value})} disabled={isReadOnly} className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100" />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-bold text-gray-700 mb-1">Rate (mL/hr) <span className="text-red-500">*</span></label>
                  <input type="number" step="0.1" value={formData.rate} onChange={e=>setFormData({...formData, rate: e.target.value})} disabled={isReadOnly} className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100" />
                </div>
              </div>
              <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                <div className="text-sm text-blue-800 font-semibold flex justify-between">
                  <span>系統計算 給藥體積:</span>
                  <span className="text-lg">{formData.calcAdminVol.toFixed(1)} mL/day</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 右側：Step 3 */}
        <div className="lg:col-span-2">
          <div className="bg-white p-5 rounded-lg shadow border border-gray-100 h-full">
            <div className="flex justify-between items-center mb-4 border-b pb-2">
              <h3 className="text-lg font-bold flex items-center gap-2 text-blue-800">
                <span className="bg-blue-600 text-white w-6 h-6 rounded-full inline-flex justify-center items-center text-sm">3</span> 
                成分與劑量調整
              </h3>
              {!isReadOnly && <span className="text-xs text-gray-500 flex items-center gap-1"><AlertTriangle size={14}/> 編輯劑量欄位將自動反算配方濃度</span>}
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="p-2 text-left w-1/4">成分名稱</th>
                    <th className="p-2 text-right w-1/4">處方濃度</th>
                    <th className="p-2 text-right w-1/4 bg-yellow-50">劑量/體重</th>
                    <th className="p-2 text-left w-1/4">備註</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {ELEMENTS.map(el => {
                    const data = formData.elements[el.key];
                    const hasError = validationErrors[el.key];
                    const limit = db.limits[el.key];
                    
                    return (
                      <tr key={el.key} className={hasError ? 'bg-red-50' : 'hover:bg-gray-50'}>
                        <td className="p-2 font-medium align-top pt-3">{el.label}</td>
                        <td className="p-2 text-right text-gray-600 align-top pt-3">
                          {Number(data.conc).toFixed(1)} <span className="text-xs">{el.unit1}</span>
                        </td>
                        <td className="p-2 text-right bg-yellow-50 align-top">
                          <div className="flex flex-col items-end">
                            <div className="flex items-center justify-end gap-1">
                              <input 
                                type="number" 
                                step="0.1"
                                value={data.dose === 0 ? '' : Number(data.dose).toFixed(1).replace(/\.?0+$/, '')} // 移除結尾的0使UI乾淨，最多顯示1位小數
                                onChange={(e) => handleDoseChange(el.key, e.target.value)}
                                disabled={isReadOnly || el.key === 'kcal'}
                                className={`w-20 text-right p-1 border rounded ${hasError ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'} disabled:bg-transparent disabled:border-none disabled:font-bold ${el.key === 'kcal' && !isReadOnly ? 'text-blue-800' : ''}`}
                              />
                              <span className="text-xs text-gray-500 w-16 text-left">{el.unit2}</span>
                            </div>
                            {/* 移除 absolute，改為 normal flow 並對齊 input 正下方 */}
                            {hasError && (
                              <div className="text-xs text-red-600 font-bold mt-1 pr-[4.25rem] whitespace-nowrap">
                                {hasError}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="p-2 align-top">
                          <input 
                            type="text" 
                            value={data.remark} 
                            onChange={e => setFormData(p => ({...p, elements: {...p.elements, [el.key]: {...p.elements[el.key], remark: e.target.value}}}))}
                            disabled={isReadOnly}
                            className="w-full p-1 border rounded text-xs disabled:bg-transparent disabled:border-none"
                            placeholder={isReadOnly ? '' : "備註..."}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 提示區塊 */}
            {!isReadOnly && (
              <div className="mt-6 p-3 bg-blue-50 border border-blue-200 rounded text-xs text-gray-600">
                <p><strong>連動邏輯說明：</strong> 當您修改黃色背景的「劑量/體重」時，系統會依據當前的給藥體積與體重，自動反向計算該單一成分的「處方濃度」。其他成分會維持原本的處方濃度不變，且處方套餐會自動標示為「自訂」。<br/>
                <span className="text-blue-800 font-semibold mt-1 inline-block">* 備註：熱量 (Kcal) 為衍生計算值，系統會依照 (CHO g/L × 3.4 + Amino acid g/L × 4) 公式自動推算，不開放直接修改。</span></p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 新增 Step 4: 其他添加 (獨立橫跨全寬) */}
      <div className="bg-white p-5 rounded-lg shadow border border-gray-100">
        <div className="flex justify-between items-center mb-4 border-b pb-2">
          <h3 className="text-lg font-bold flex items-center gap-2 text-blue-800">
            <span className="bg-blue-600 text-white w-6 h-6 rounded-full inline-flex justify-center items-center text-sm">4</span> 
            其他添加
          </h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {OTHER_ADDITIONS.map(item => {
            const val = formData.otherAdditions[item.key];
            return (
              <div key={item.key} className="bg-gray-50 p-3 rounded border border-gray-200">
                <label className="block text-sm font-bold text-gray-700 mb-2">{item.label}</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="number" 
                    step="0.1"
                    value={val !== '' ? Number(val).toString() : ''} 
                    onChange={e => setFormData(p => ({
                      ...p, 
                      otherAdditions: { ...p.otherAdditions, [item.key]: e.target.value }
                    }))}
                    disabled={isReadOnly}
                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 text-right disabled:bg-transparent disabled:border-none disabled:font-bold disabled:text-blue-800 disabled:p-0"
                    placeholder="0.0"
                  />
                  <span className="text-sm text-gray-500 font-medium w-6">{item.unit}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 動作按鈕區 (依據權限與狀態動態顯示) */}
      <div className="bg-gray-800 p-4 rounded-lg shadow flex justify-between items-center">
        <div>
          {!isReadOnly && formData.orderId && (
            <button onClick={handleDelete} className="text-red-400 hover:text-red-300 flex items-center gap-2 text-sm font-semibold">
              <Trash2 size={16}/> 刪除草稿
            </button>
          )}
        </div>
        <div className="flex gap-4">
          {/* Draft 狀態動作 */}
          {!isReadOnly && (
            <>
              <button onClick={() => saveOrder('Draft')} className="bg-gray-600 text-white px-6 py-2 rounded font-semibold hover:bg-gray-500 transition">
                儲存暫存
              </button>
              {['doctor', 'np'].includes(user.role) && (
                <button onClick={() => saveOrder('Submitted')} className="bg-blue-600 text-white px-8 py-2 rounded font-bold hover:bg-blue-500 transition flex items-center gap-2">
                  <CheckCircle size={18}/> 醫師完成 (Submit)
                </button>
              )}
            </>
          )}

          {/* Submitted 狀態動作 */}
          {formData.status === 'Submitted' && (
            <>
              {['doctor', 'np'].includes(user.role) && (
                <button onClick={handleRevise} className="bg-yellow-500 text-white px-6 py-2 rounded font-bold hover:bg-yellow-400 transition flex items-center gap-2">
                  <Edit size={18}/> 修改處方 (產生新版)
                </button>
              )}
              {user.role === 'pharmacist' && (
                <button onClick={handleDispense} className="bg-green-600 text-white px-8 py-2 rounded font-bold hover:bg-green-500 transition flex items-center gap-2">
                  <Syringe size={18}/> 確認已調配
                </button>
              )}
            </>
          )}

          {/* Dispensed 狀態動作 */}
          {formData.status === 'Dispensed' && (
            <div className="text-green-400 font-bold flex items-center gap-2">
              <CheckCircle /> 處方已由藥師調配，不可修改
            </div>
          )}
        </div>
      </div>
    </div>
  );
}