// auth.js
// Simple client-side authentication using localStorage
// Data schema in localStorage:
// - pos_users: [{name,email,password,isAdmin}]
// - pos_session: {email}

(function(){
  // Ensure default admin exists on first run
  function loadUsers(){
    const raw = localStorage.getItem('pos_users');
    return raw ? JSON.parse(raw) : [];
  }
  function saveUsers(users){ localStorage.setItem('pos_users', JSON.stringify(users)); }

  // Initialize default admin if missing
  const users = loadUsers();
  if(!users.find(u => u.email === 'admin@admin.com')){
    users.push({name:'Admin', email:'admin@admin.com', password:'admin', isAdmin:true});
    saveUsers(users);
  }

  // Expose functions globally for simplicity (MVP)
  window.registerUser = function({name,email,password}){
    email = email.toLowerCase();
    const list = loadUsers();
    if(list.find(u=>u.email===email)) return {success:false, message:'Email already registered'};
    const user = {name, email, password, isAdmin:false};
    list.push(user); saveUsers(list);
    // auto-login after register
    localStorage.setItem('pos_session', JSON.stringify({email}));
    return {success:true};
  }

  window.loginUser = function(email, password){
    email = (email||'').toLowerCase();
    const list = loadUsers();
    const usr = list.find(u=>u.email===email && u.password===password);
    if(!usr) return {success:false, message:'Invalid credentials'};
    localStorage.setItem('pos_session', JSON.stringify({email}));
    return {success:true};
  }

  window.getCurrentUser = function(){
    const s = localStorage.getItem('pos_session');
    if(!s) return null;
    const {email} = JSON.parse(s);
    const list = loadUsers();
    return list.find(u=>u.email===email) || null;
  }

  window.logoutUser = function(){ localStorage.removeItem('pos_session'); }

})();
