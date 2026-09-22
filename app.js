/* Corporate Ledger Manager — vanilla JS, localStorage + optional GitHub backup */
(function(){
  "use strict";

  const CURRENCIES = ["INR","USD","AED","SGD","THB"];
  const STORE_KEY = "clm_state_v1";
  const TOKEN_KEY = "clm_gh_token_v1";
  const EPS = 0.005;

  // ---------- state ----------
  function defaultState(){
    return {
      corporates: [],
      bookings: [],
      payments: [],
      settings: {
        company: { name:"", address:"", email:"", phone:"" },
        github: { owner:"", repo:"", branch:"main", path:"data/corporate-ledger-backup.json", autoBackup:false, lastBackupAt:"" }
      }
    };
  }
  let state = loadState();

  function loadState(){
    try{
      const raw = localStorage.getItem(STORE_KEY);
      if(!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const d = defaultState();
      return Object.assign(d, parsed, {
        settings: Object.assign(d.settings, parsed.settings || {}, {
          company: Object.assign(d.settings.company, (parsed.settings||{}).company || {}),
          github: Object.assign(d.settings.github, (parsed.settings||{}).github || {})
        })
      });
    }catch(e){
      console.error("Failed to load state", e);
      return defaultState();
    }
  }

  function saveState(opts){
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    renderAll();
    if(state.settings.github.autoBackup && (!opts || opts.skipAutoBackup !== true)){
      backupToGithub({silent:true});
    }
  }

  function uid(prefix){
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
  }

  function getToken(){ return localStorage.getItem(TOKEN_KEY) || ""; }
  function setToken(t){ if(t){ localStorage.setItem(TOKEN_KEY, t); } }

  // ---------- helpers ----------
  function escapeHtml(str){
    if(str === undefined || str === null) return "";
    return String(str).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];
    });
  }

  function fmtMoney(n, currency){
    const num = Number(n)||0;
    const abs = Math.abs(num).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2});
    const sign = num < 0 ? "-" : "";
    return sign + (currency? currency+" " : "") + abs;
  }

  function fmtDate(d){
    if(!d) return "";
    try{
      const dt = new Date(d+"T00:00:00");
      if(isNaN(dt.getTime())) return d;
      return dt.toLocaleDateString(undefined,{day:"2-digit",month:"short",year:"numeric"});
    }catch(e){ return d; }
  }

  function toast(msg, isError){
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "toast show" + (isError? " error":"");
    clearTimeout(toast._t);
    toast._t = setTimeout(()=>{ t.className = "toast"; }, 3200);
  }

  function corpById(id){ return state.corporates.find(c=>c.id===id); }
  function bookingById(id){ return state.bookings.find(b=>b.id===id); }

  // ---------- derived / computation ----------
  function receivedForBooking(bookingId){
    let sum = 0;
    state.payments.forEach(p=>{
      (p.allocations||[]).forEach(a=>{
        if(a.bookingId === bookingId) sum += Number(a.amount)||0;
      });
    });
    return sum;
  }

  function bookingStatus(booking){
    const received = receivedForBooking(booking.id);
    const balance = Number(booking.invoiceAmount||0) - received;
    let status;
    if(received <= EPS) status = "outstanding";
    else if(balance > EPS) status = "partial";
    else if(balance < -EPS) status = "overpaid";
    else status = "settled";
    return {received, balance, status};
  }

  const STATUS_LABELS = {
    outstanding: "Outstanding",
    partial: "Partial",
    settled: "Settled",
    overpaid: "Overpaid / Credit"
  };

  function statusLabel(status){ return STATUS_LABELS[status] || status; }

  function statusBadge(status){
    return `<span class="badge ${status}">${statusLabel(status)}</span>`;
  }

  function allocatedForPayment(payment){
    return (payment.allocations||[]).reduce((s,a)=>s+(Number(a.amount)||0),0);
  }

  function unallocatedForPayment(payment){
    return (Number(payment.totalAmount)||0) - allocatedForPayment(payment);
  }

  function currencyTotals(bookings){
    const out = {};
    bookings.forEach(b=>{
      const cur = b.currency;
      if(!out[cur]) out[cur] = {invoiced:0, received:0, outstanding:0, credit:0, count:0, settledCount:0, outstandingCount:0, partialCount:0};
      const {received, balance, status} = bookingStatus(b);
      out[cur].invoiced += Number(b.invoiceAmount||0);
      out[cur].received += received;
      out[cur].count += 1;
      if(status === "settled") out[cur].settledCount++;
      if(status === "outstanding") out[cur].outstandingCount++;
      if(status === "partial") out[cur].partialCount++;
      if(balance > EPS) out[cur].outstanding += balance;
      if(balance < -EPS) out[cur].credit += Math.abs(balance);
    });
    return out;
  }

  // ---------- tabs ----------
  document.getElementById("tabs").addEventListener("click", function(e){
    const btn = e.target.closest("button[data-view]");
    if(!btn) return;
    document.querySelectorAll("nav.tabs button").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
    document.getElementById("view-"+btn.dataset.view).classList.add("active");
    if(btn.dataset.view === "ledger") renderLedger();
    if(btn.dataset.view === "dashboard") renderDashboard();
  });

  // ================= CORPORATES =================
  const corpForm = document.getElementById("corpForm");
  corpForm.addEventListener("submit", function(e){
    e.preventDefault();
    const id = document.getElementById("corpId").value;
    const name = document.getElementById("corpName").value.trim();
    if(!name){ toast("Corporate name is required", true); return; }
    const rec = {
      id: id || uid("corp"),
      name,
      code: document.getElementById("corpCode").value.trim(),
      contact: document.getElementById("corpContact").value.trim(),
      email: document.getElementById("corpEmail").value.trim(),
      phone: document.getElementById("corpPhone").value.trim(),
      notes: document.getElementById("corpNotes").value.trim(),
    };
    if(id){
      const idx = state.corporates.findIndex(c=>c.id===id);
      state.corporates[idx] = rec;
      toast("Corporate updated");
    } else {
      state.corporates.push(rec);
      toast("Corporate added");
    }
    corpForm.reset();
    document.getElementById("corpId").value = "";
    document.getElementById("corpFormTitle").textContent = "Add Corporate";
    document.getElementById("corpCancelEdit").style.display = "none";
    saveState();
  });
  document.getElementById("corpCancelEdit").addEventListener("click", function(){
    corpForm.reset();
    document.getElementById("corpId").value = "";
    document.getElementById("corpFormTitle").textContent = "Add Corporate";
    this.style.display = "none";
  });

  function editCorporate(id){
    const c = corpById(id);
    if(!c) return;
    document.getElementById("corpId").value = c.id;
    document.getElementById("corpName").value = c.name;
    document.getElementById("corpCode").value = c.code||"";
    document.getElementById("corpContact").value = c.contact||"";
    document.getElementById("corpEmail").value = c.email||"";
    document.getElementById("corpPhone").value = c.phone||"";
    document.getElementById("corpNotes").value = c.notes||"";
    document.getElementById("corpFormTitle").textContent = "Edit Corporate";
    document.getElementById("corpCancelEdit").style.display = "inline-flex";
    document.querySelector('nav.tabs button[data-view="corporates"]').click();
    window.scrollTo({top:0, behavior:"smooth"});
  }

  function deleteCorporate(id){
    const usedBookings = state.bookings.some(b=>b.corporateId===id);
    const usedPayments = state.payments.some(p=>p.corporateId===id);
    if(usedBookings || usedPayments){
      if(!confirm("This corporate has bookings/payments linked to it. Deleting it will also delete ALL its bookings and payments. Continue?")) return;
      state.bookings = state.bookings.filter(b=>b.corporateId!==id);
      state.payments = state.payments.filter(p=>p.corporateId!==id);
    } else {
      if(!confirm("Delete this corporate?")) return;
    }
    state.corporates = state.corporates.filter(c=>c.id!==id);
    toast("Corporate deleted");
    saveState();
  }

  document.getElementById("corpSearch").addEventListener("input", renderCorporates);

  function renderCorporates(){
    const q = (document.getElementById("corpSearch").value||"").toLowerCase();
    const rows = state.corporates
      .filter(c=> !q || c.name.toLowerCase().includes(q) || (c.code||"").toLowerCase().includes(q))
      .map(c=>{
        const bookings = state.bookings.filter(b=>b.corporateId===c.id);
        const totals = currencyTotals(bookings);
        const outstandingStr = Object.keys(totals).filter(cur=>totals[cur].outstanding>EPS)
          .map(cur=>`<span class="pill">${escapeHtml(cur)} ${fmtMoney(totals[cur].outstanding)}</span>`).join("") || '<span class="muted">—</span>';
        return `<tr>
          <td><b>${escapeHtml(c.name)}</b>${c.code?`<div class="sub muted">${escapeHtml(c.code)}</div>`:""}</td>
          <td>${escapeHtml(c.contact||"")}${c.email?`<div class="sub muted">${escapeHtml(c.email)}</div>`:""}</td>
          <td>${escapeHtml(c.phone||"")}</td>
          <td>${bookings.length}</td>
          <td>${outstandingStr}</td>
          <td class="no-print">
            <button class="btn ghost small" onclick="CLM.editCorporate('${c.id}')">Edit</button>
            <button class="btn danger small" onclick="CLM.deleteCorporate('${c.id}')">Delete</button>
          </td>
        </tr>`;
      }).join("");
    document.getElementById("corpTable").innerHTML = `
      <thead><tr><th>Corporate</th><th>Contact</th><th>Phone</th><th># Bookings</th><th>Outstanding</th><th class="no-print">Actions</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="empty">No corporates yet. Add one above.</td></tr>`}</tbody>`;
  }

  function refreshCorpDropdowns(){
    const opts = state.corporates.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
    ["bookCorp","payCorp","stmtCorp"].forEach(id=>{
      const el = document.getElementById(id);
      const cur = el.value;
      el.innerHTML = opts || `<option value="">No corporates yet</option>`;
      if(cur) el.value = cur;
    });
    ["bookFilterCorp","payFilterCorp","ledgerCorp"].forEach(id=>{
      const el = document.getElementById(id);
      const cur = el.value;
      el.innerHTML = `<option value="">All Corporates</option>` + opts;
      if(cur) el.value = cur;
    });
  }

  // ================= BOOKINGS =================
  const bookForm = document.getElementById("bookForm");
  bookForm.addEventListener("submit", function(e){
    e.preventDefault();
    const id = document.getElementById("bookId").value;
    const corporateId = document.getElementById("bookCorp").value;
    const billNumber = document.getElementById("bookBillNo").value.trim();
    const invoiceAmount = parseFloat(document.getElementById("bookAmount").value);
    if(!corporateId){ toast("Please select a corporate", true); return; }
    if(!billNumber){ toast("Bill number is required", true); return; }
    if(isNaN(invoiceAmount) || invoiceAmount < 0){ toast("Enter a valid invoice amount", true); return; }
    const rec = {
      id: id || uid("bkg"),
      corporateId,
      billNumber,
      description: document.getElementById("bookDesc").value.trim(),
      checkin: document.getElementById("bookCheckin").value,
      checkout: document.getElementById("bookCheckout").value,
      pax: document.getElementById("bookPax").value.trim(),
      currency: document.getElementById("bookCurrency").value,
      invoiceAmount,
      salesPerson: document.getElementById("bookSales").value.trim(),
      invoiceDate: document.getElementById("bookInvDate").value,
      createdAt: id ? (bookingById(id)||{}).createdAt || new Date().toISOString() : new Date().toISOString()
    };
    if(id){
      const idx = state.bookings.findIndex(b=>b.id===id);
      state.bookings[idx] = rec;
      toast("Booking updated");
    } else {
      state.bookings.push(rec);
      toast("Booking added");
    }
    bookForm.reset();
    document.getElementById("bookId").value = "";
    document.getElementById("bookFormTitle").textContent = "Add Booking";
    document.getElementById("bookCancelEdit").style.display = "none";
    saveState();
  });
  document.getElementById("bookCancelEdit").addEventListener("click", function(){
    bookForm.reset();
    document.getElementById("bookId").value = "";
    document.getElementById("bookFormTitle").textContent = "Add Booking";
    this.style.display = "none";
  });

  function editBooking(id){
    const b = bookingById(id);
    if(!b) return;
    document.getElementById("bookId").value = b.id;
    document.getElementById("bookCorp").value = b.corporateId;
    document.getElementById("bookBillNo").value = b.billNumber;
    document.getElementById("bookDesc").value = b.description||"";
    document.getElementById("bookCheckin").value = b.checkin||"";
    document.getElementById("bookCheckout").value = b.checkout||"";
    document.getElementById("bookPax").value = b.pax||"";
    document.getElementById("bookCurrency").value = b.currency;
    document.getElementById("bookAmount").value = b.invoiceAmount;
    document.getElementById("bookSales").value = b.salesPerson||"";
    document.getElementById("bookInvDate").value = b.invoiceDate||"";
    document.getElementById("bookFormTitle").textContent = "Edit Booking";
    document.getElementById("bookCancelEdit").style.display = "inline-flex";
    document.querySelector('nav.tabs button[data-view="bookings"]').click();
    window.scrollTo({top:0, behavior:"smooth"});
  }

  function deleteBooking(id){
    const usedInPayments = state.payments.some(p=>(p.allocations||[]).some(a=>a.bookingId===id));
    if(usedInPayments && !confirm("Payments are allocated against this booking. Deleting it will remove those allocations (the payment amounts remain, just unallocated). Continue?")) return;
    if(!usedInPayments && !confirm("Delete this booking?")) return;
    state.payments.forEach(p=>{ p.allocations = (p.allocations||[]).filter(a=>a.bookingId!==id); });
    state.bookings = state.bookings.filter(b=>b.id!==id);
    toast("Booking deleted");
    saveState();
  }

  ["bookFilterCorp","bookFilterStatus","bookSearch"].forEach(id=>{
    document.getElementById(id).addEventListener("input", renderBookings);
    document.getElementById(id).addEventListener("change", renderBookings);
  });

  function renderBookings(){
    const fc = document.getElementById("bookFilterCorp").value;
    const fs = document.getElementById("bookFilterStatus").value;
    const q = (document.getElementById("bookSearch").value||"").toLowerCase();
    const rows = state.bookings
      .filter(b=> !fc || b.corporateId===fc)
      .filter(b=> !q || b.billNumber.toLowerCase().includes(q) || (b.description||"").toLowerCase().includes(q))
      .sort((a,b)=> (b.invoiceDate||"").localeCompare(a.invoiceDate||""))
      .map(b=>{
        const {received, balance, status} = bookingStatus(b);
        if(fs && status!==fs) return "";
        const corp = corpById(b.corporateId);
        return `<tr>
          <td><b>${escapeHtml(b.billNumber)}</b></td>
          <td>${escapeHtml(corp? corp.name : "—")}</td>
          <td>${escapeHtml(b.description||"")}${b.pax?`<div class="sub muted">Pax: ${escapeHtml(b.pax)}</div>`:""}</td>
          <td>${fmtDate(b.checkin)}${b.checkout?" → "+fmtDate(b.checkout):""}</td>
          <td class="right">${fmtMoney(b.invoiceAmount, b.currency)}</td>
          <td class="right">${fmtMoney(received, b.currency)}</td>
          <td class="right">${fmtMoney(balance, b.currency)}</td>
          <td>${statusBadge(status)}</td>
          <td class="no-print">
            <button class="btn ghost small" onclick="CLM.editBooking('${b.id}')">Edit</button>
            <button class="btn danger small" onclick="CLM.deleteBooking('${b.id}')">Delete</button>
          </td>
        </tr>`;
      }).filter(Boolean).join("");
    document.getElementById("bookTable").innerHTML = `
      <thead><tr><th>Bill No.</th><th>Corporate</th><th>Description</th><th>Dates</th><th class="right">Invoice</th><th class="right">Received</th><th class="right">Balance</th><th>Status</th><th class="no-print">Actions</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="9" class="empty">No bookings found.</td></tr>`}</tbody>`;
  }

  // ================= PAYMENTS =================
  let currentAllocations = []; // {bookingId, amount}

  function renderAllocList(){
    const corporateId = document.getElementById("payCorp").value;
    const currency = document.getElementById("payCurrency").value;
    const editingId = document.getElementById("payId").value;
    const bookings = state.bookings.filter(b=>b.corporateId===corporateId && b.currency===currency);
    const list = document.getElementById("allocList");
    if(!corporateId){
      list.innerHTML = `<div class="empty">Select a corporate first.</div>`;
    } else if(bookings.length===0){
      list.innerHTML = `<div class="empty">No ${escapeHtml(currency)} bookings for this corporate yet.</div>`;
    } else {
      list.innerHTML = bookings.map(b=>{
        const {balance} = bookingStatus(b);
        // if editing this payment, exclude its own prior allocation from "already received elsewhere" so balance reflects pre-edit state
        let adjBalance = balance;
        if(editingId){
          const prior = (state.payments.find(p=>p.id===editingId)||{allocations:[]}).allocations||[];
          const priorAmt = prior.filter(a=>a.bookingId===b.id).reduce((s,a)=>s+Number(a.amount||0),0);
          adjBalance = balance + priorAmt;
        }
        const existing = currentAllocations.find(a=>a.bookingId===b.id);
        const val = existing ? existing.amount : "";
        return `<div class="alloc-row">
          <div><span class="bn">${escapeHtml(b.billNumber)}</span><div class="sub">${escapeHtml(b.description||"")}</div></div>
          <div class="sub">Due: ${fmtMoney(adjBalance)}</div>
          <div><input type="number" step="0.01" data-bid="${b.id}" class="alloc-input" placeholder="0.00" value="${val}"></div>
          <div class="sub">${b.currency}</div>
        </div>`;
      }).join("");
      list.querySelectorAll(".alloc-input").forEach(inp=>{
        inp.addEventListener("input", function(){
          const bid = this.dataset.bid;
          const amt = parseFloat(this.value);
          currentAllocations = currentAllocations.filter(a=>a.bookingId!==bid);
          if(!isNaN(amt) && amt>0) currentAllocations.push({bookingId:bid, amount:amt});
          updateAllocSummary();
        });
      });
    }
    updateAllocSummary();
  }

  function updateAllocSummary(){
    const total = parseFloat(document.getElementById("payAmount").value)||0;
    const allocSum = currentAllocations.reduce((s,a)=>s+Number(a.amount||0),0);
    document.getElementById("allocSum").textContent = allocSum.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
    document.getElementById("allocRemaining").textContent = (total-allocSum).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  }

  document.getElementById("payCorp").addEventListener("change", ()=>{ currentAllocations = []; renderAllocList(); });
  document.getElementById("payCurrency").addEventListener("change", ()=>{ currentAllocations = []; renderAllocList(); });
  document.getElementById("payAmount").addEventListener("input", updateAllocSummary);

  document.getElementById("btnAutoAllocate").addEventListener("click", function(){
    const corporateId = document.getElementById("payCorp").value;
    const currency = document.getElementById("payCurrency").value;
    let remaining = parseFloat(document.getElementById("payAmount").value)||0;
    if(!corporateId || remaining<=0){ toast("Enter corporate & amount first", true); return; }
    const editingId = document.getElementById("payId").value;
    const bookings = state.bookings
      .filter(b=>b.corporateId===corporateId && b.currency===currency)
      .map(b=>{
        const {balance} = bookingStatus(b);
        let adjBalance = balance;
        if(editingId){
          const prior = (state.payments.find(p=>p.id===editingId)||{allocations:[]}).allocations||[];
          const priorAmt = prior.filter(a=>a.bookingId===b.id).reduce((s,a)=>s+Number(a.amount||0),0);
          adjBalance = balance + priorAmt;
        }
        return {b, adjBalance};
      })
      .filter(x=>x.adjBalance>EPS)
      .sort((x,y)=> (x.b.invoiceDate||"").localeCompare(y.b.invoiceDate||""));
    currentAllocations = [];
    bookings.forEach(({b,adjBalance})=>{
      if(remaining<=EPS) return;
      const amt = Math.min(remaining, adjBalance);
      currentAllocations.push({bookingId:b.id, amount: Math.round(amt*100)/100});
      remaining -= amt;
    });
    renderAllocList();
    toast("Auto-allocated oldest bills first");
  });

  document.getElementById("btnClearAllocate").addEventListener("click", function(){
    currentAllocations = [];
    renderAllocList();
  });

  const payForm = document.getElementById("payForm");
  payForm.addEventListener("submit", function(e){
    e.preventDefault();
    const id = document.getElementById("payId").value;
    const corporateId = document.getElementById("payCorp").value;
    const totalAmount = parseFloat(document.getElementById("payAmount").value);
    if(!corporateId){ toast("Please select a corporate", true); return; }
    if(isNaN(totalAmount) || totalAmount<=0){ toast("Enter a valid amount", true); return; }
    const allocSum = currentAllocations.reduce((s,a)=>s+Number(a.amount||0),0);
    if(allocSum - totalAmount > EPS){
      toast("Allocated amount cannot exceed the total payment amount", true); return;
    }
    const rec = {
      id: id || uid("pay"),
      corporateId,
      date: document.getElementById("payDate").value,
      currency: document.getElementById("payCurrency").value,
      totalAmount,
      notes: document.getElementById("payNotes").value.trim(),
      allocations: currentAllocations.map(a=>({bookingId:a.bookingId, amount:a.amount})),
      createdAt: id ? (state.payments.find(p=>p.id===id)||{}).createdAt || new Date().toISOString() : new Date().toISOString()
    };
    if(id){
      const idx = state.payments.findIndex(p=>p.id===id);
      state.payments[idx] = rec;
      toast("Payment updated");
    } else {
      state.payments.push(rec);
      toast("Payment added");
    }
    payForm.reset();
    currentAllocations = [];
    document.getElementById("payId").value = "";
    document.getElementById("payFormTitle").textContent = "Add Payment";
    document.getElementById("payCancelEdit").style.display = "none";
    renderAllocList();
    saveState();
  });
  document.getElementById("payCancelEdit").addEventListener("click", function(){
    payForm.reset();
    currentAllocations = [];
    document.getElementById("payId").value = "";
    document.getElementById("payFormTitle").textContent = "Add Payment";
    this.style.display = "none";
    renderAllocList();
  });

  function editPayment(id){
    const p = state.payments.find(x=>x.id===id);
    if(!p) return;
    document.getElementById("payId").value = p.id;
    document.getElementById("payCorp").value = p.corporateId;
    document.getElementById("payDate").value = p.date||"";
    document.getElementById("payCurrency").value = p.currency;
    document.getElementById("payAmount").value = p.totalAmount;
    document.getElementById("payNotes").value = p.notes||"";
    currentAllocations = (p.allocations||[]).map(a=>({bookingId:a.bookingId, amount:a.amount}));
    document.getElementById("payFormTitle").textContent = "Edit Payment";
    document.getElementById("payCancelEdit").style.display = "inline-flex";
    renderAllocList();
    document.querySelector('nav.tabs button[data-view="payments"]').click();
    window.scrollTo({top:0, behavior:"smooth"});
  }

  function deletePayment(id){
    if(!confirm("Delete this payment and its allocations?")) return;
    state.payments = state.payments.filter(p=>p.id!==id);
    toast("Payment deleted");
    saveState();
  }

  ["payFilterCorp","paySearch"].forEach(id=>{
    document.getElementById(id).addEventListener("input", renderPayments);
    document.getElementById(id).addEventListener("change", renderPayments);
  });

  function renderPayments(){
    const fc = document.getElementById("payFilterCorp").value;
    const q = (document.getElementById("paySearch").value||"").toLowerCase();
    const rows = state.payments
      .filter(p=> !fc || p.corporateId===fc)
      .filter(p=>{
        if(!q) return true;
        const billNos = (p.allocations||[]).map(a=>{ const b=bookingById(a.bookingId); return b?b.billNumber:""; }).join(" ").toLowerCase();
        return billNos.includes(q) || (p.notes||"").toLowerCase().includes(q);
      })
      .sort((a,b)=> (b.date||"").localeCompare(a.date||""))
      .map(p=>{
        const corp = corpById(p.corporateId);
        const unalloc = unallocatedForPayment(p);
        const chips = (p.allocations||[]).map(a=>{
          const b = bookingById(a.bookingId);
          return `<span class="pill">${b?escapeHtml(b.billNumber):"?"}: ${fmtMoney(a.amount)}</span>`;
        }).join("") || '<span class="muted">Unallocated</span>';
        return `<tr>
          <td>${fmtDate(p.date)}</td>
          <td>${escapeHtml(corp?corp.name:"—")}</td>
          <td class="right">${fmtMoney(p.totalAmount, p.currency)}</td>
          <td>${chips}</td>
          <td class="right">${unalloc>EPS? `<span class="badge overpaid">${fmtMoney(unalloc,p.currency)}</span>` : "—"}</td>
          <td>${escapeHtml(p.notes||"")}</td>
          <td class="no-print">
            <button class="btn ghost small" onclick="CLM.editPayment('${p.id}')">Edit</button>
            <button class="btn danger small" onclick="CLM.deletePayment('${p.id}')">Delete</button>
          </td>
        </tr>`;
      }).join("");
    document.getElementById("payTable").innerHTML = `
      <thead><tr><th>Date</th><th>Corporate</th><th class="right">Amount</th><th>Allocated To</th><th>Unallocated</th><th>Notes</th><th class="no-print">Actions</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7" class="empty">No payments recorded yet.</td></tr>`}</tbody>`;
  }

  // ================= LEDGER =================
  ["ledgerCorp","ledgerCurrency","ledgerStatus"].forEach(id=>{
    document.getElementById(id).addEventListener("change", renderLedger);
  });

  function renderLedger(){
    const fc = document.getElementById("ledgerCorp").value;
    const fcur = document.getElementById("ledgerCurrency").value;
    const fs = document.getElementById("ledgerStatus").value;

    // populate currency filter once
    const curSel = document.getElementById("ledgerCurrency");
    if(curSel.options.length<=1){
      curSel.innerHTML = `<option value="">All Currencies</option>` + CURRENCIES.map(c=>`<option>${c}</option>`).join("");
    }

    let bookings = state.bookings.filter(b=> !fc || b.corporateId===fc).filter(b=> !fcur || b.currency===fcur);

    const totals = currencyTotals(bookings);
    const cards = Object.keys(totals).sort().map(cur=>{
      const t = totals[cur];
      return `<div class="stat"><div class="label">${cur} Invoiced</div><div class="value">${fmtMoney(t.invoiced)}</div></div>
              <div class="stat"><div class="label">${cur} Received</div><div class="value green">${fmtMoney(t.received)}</div></div>
              <div class="stat"><div class="label">${cur} Outstanding</div><div class="value red">${fmtMoney(t.outstanding)}</div></div>
              <div class="stat"><div class="label">${cur} Credit/Advance</div><div class="value blue">${fmtMoney(t.credit)}</div></div>`;
    }).join("");
    document.getElementById("ledgerSummaryCards").innerHTML = cards || `<div class="empty">No bookings match this filter.</div>`;

    const rows = bookings
      .sort((a,b)=> (b.invoiceDate||"").localeCompare(a.invoiceDate||""))
      .map(b=>{
        const {received, balance, status} = bookingStatus(b);
        if(fs && status!==fs) return "";
        const corp = corpById(b.corporateId);
        return `<tr>
          <td>${escapeHtml(corp?corp.name:"—")}</td>
          <td><b>${escapeHtml(b.billNumber)}</b><div class="sub muted">${escapeHtml(b.description||"")}</div></td>
          <td>${b.currency}</td>
          <td class="right">${fmtMoney(b.invoiceAmount)}</td>
          <td class="right">${fmtMoney(received)}</td>
          <td class="right">${fmtMoney(balance)}</td>
          <td>${statusBadge(status)}</td>
        </tr>`;
      }).filter(Boolean).join("");
    document.getElementById("ledgerTable").innerHTML = `
      <thead><tr><th>Corporate</th><th>Bill No. / Desc</th><th>Currency</th><th class="right">Invoice</th><th class="right">Received</th><th class="right">Balance</th><th>Status</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7" class="empty">No bills match this filter.</td></tr>`}</tbody>`;
  }

  // ================= DASHBOARD =================
  function renderDashboard(){
    const totals = currencyTotals(state.bookings);
    const totalOutstandingBills = state.bookings.filter(b=>bookingStatus(b).status==="outstanding" || bookingStatus(b).status==="partial").length;
    const totalSettled = state.bookings.filter(b=>bookingStatus(b).status==="settled").length;
    document.getElementById("dashStats").innerHTML = `
      <div class="stat"><div class="label">Corporates</div><div class="value">${state.corporates.length}</div></div>
      <div class="stat"><div class="label">Total Bookings</div><div class="value">${state.bookings.length}</div></div>
      <div class="stat"><div class="label">Bills Outstanding/Partial</div><div class="value red">${totalOutstandingBills}</div></div>
      <div class="stat"><div class="label">Bills Settled</div><div class="value green">${totalSettled}</div></div>
    `;

    const rows = [];
    state.corporates.forEach(c=>{
      const bookings = state.bookings.filter(b=>b.corporateId===c.id);
      const t = currencyTotals(bookings);
      Object.keys(t).forEach(cur=>{
        if(t[cur].outstanding>EPS){
          rows.push(`<tr><td>${escapeHtml(c.name)}</td><td>${cur}</td><td class="right">${fmtMoney(t[cur].outstanding)}</td></tr>`);
        }
      });
    });
    document.getElementById("dashOutstandingTable").innerHTML = `
      <thead><tr><th>Corporate</th><th>Currency</th><th class="right">Outstanding</th></tr></thead>
      <tbody>${rows.join("") || `<tr><td colspan="3" class="empty">Nothing outstanding 🎉</td></tr>`}</tbody>`;

    const activity = [];
    state.bookings.forEach(b=>{
      const corp = corpById(b.corporateId);
      activity.push({date: b.invoiceDate || b.createdAt || "", type:"Booking", corp: corp?corp.name:"—", detail: b.billNumber, amount: fmtMoney(b.invoiceAmount,b.currency)});
    });
    state.payments.forEach(p=>{
      const corp = corpById(p.corporateId);
      const billNos = (p.allocations||[]).map(a=>{const b=bookingById(a.bookingId); return b?b.billNumber:"";}).filter(Boolean).join(", ");
      activity.push({date: p.date || p.createdAt || "", type:"Payment", corp: corp?corp.name:"—", detail: billNos||"(unallocated)", amount: fmtMoney(p.totalAmount,p.currency)});
    });
    activity.sort((a,b)=> (b.date||"").localeCompare(a.date||""));
    const recentRows = activity.slice(0,10).map(a=>`<tr><td>${fmtDate(a.date)}</td><td>${a.type}</td><td>${escapeHtml(a.corp)}</td><td>${escapeHtml(a.detail)}</td><td class="right">${a.amount}</td></tr>`).join("");
    document.getElementById("dashRecentTable").innerHTML = `
      <thead><tr><th>Date</th><th>Type</th><th>Corporate</th><th>Bill No.</th><th class="right">Amount</th></tr></thead>
      <tbody>${recentRows || `<tr><td colspan="5" class="empty">No activity yet.</td></tr>`}</tbody>`;
  }

  // ================= STATEMENTS =================
  function buildStatementData(corporateId, from, to){
    const corp = corpById(corporateId);
    if(!corp) return null;
    let bookings = state.bookings.filter(b=>b.corporateId===corporateId);
    let payments = state.payments.filter(p=>p.corporateId===corporateId);
    if(from){ bookings = bookings.filter(b=>!b.invoiceDate || b.invoiceDate>=from); payments = payments.filter(p=>!p.date || p.date>=from); }
    if(to){ bookings = bookings.filter(b=>!b.invoiceDate || b.invoiceDate<=to); payments = payments.filter(p=>!p.date || p.date<=to); }
    bookings.sort((a,b)=>(a.invoiceDate||"").localeCompare(b.invoiceDate||""));
    payments.sort((a,b)=>(a.date||"").localeCompare(b.date||""));
    return {corp, bookings, payments};
  }

  function renderStatementPreviewHtml(data){
    const {corp, bookings, payments} = data;
    const co = state.settings.company;
    const totals = currencyTotals(bookings);
    const bookingRows = bookings.map(b=>{
      const {received, balance, status} = bookingStatus(b);
      return `<tr><td>${escapeHtml(b.billNumber)}</td><td>${fmtDate(b.invoiceDate)}</td><td>${escapeHtml(b.description||"")}</td><td>${b.currency}</td>
        <td class="right">${fmtMoney(b.invoiceAmount)}</td><td class="right">${fmtMoney(received)}</td><td class="right">${fmtMoney(balance)}</td><td>${statusBadge(status)}</td></tr>`;
    }).join("");
    const paymentRows = payments.map(p=>{
      const alloc = (p.allocations||[]).map(a=>{const b=bookingById(a.bookingId); return (b?b.billNumber:"?")+": "+fmtMoney(a.amount);}).join(", ");
      return `<tr><td>${fmtDate(p.date)}</td><td>${p.currency}</td><td class="right">${fmtMoney(p.totalAmount)}</td><td>${escapeHtml(alloc||"Unallocated")}</td><td>${escapeHtml(p.notes||"")}</td></tr>`;
    }).join("");
    const totalsRows = Object.keys(totals).sort().map(cur=>{
      const t = totals[cur];
      return `<tr><td>${cur}</td><td class="right">${fmtMoney(t.invoiced)}</td><td class="right">${fmtMoney(t.received)}</td><td class="right">${fmtMoney(t.outstanding)}</td><td class="right">${fmtMoney(t.credit)}</td></tr>`;
    }).join("");

    return `
      <div>
        <div class="flex-between">
          <div>
            <h2 style="margin-bottom:2px;">${escapeHtml(co.name||"Your Company")}</h2>
            <div class="muted">${escapeHtml(co.address||"")}</div>
            <div class="muted">${escapeHtml(co.email||"")} ${co.phone? " · "+escapeHtml(co.phone):""}</div>
          </div>
          <div class="right">
            <div class="muted">Statement Date</div>
            <div><b>${fmtDate(new Date().toISOString().slice(0,10))}</b></div>
          </div>
        </div>
        <hr class="sep">
        <h3>Statement of Account — ${escapeHtml(corp.name)}</h3>
        <table><thead><tr><th>Currency</th><th class="right">Invoiced</th><th class="right">Received</th><th class="right">Outstanding</th><th class="right">Credit/Advance</th></tr></thead>
        <tbody>${totalsRows || '<tr><td colspan="5" class="empty">No data</td></tr>'}</tbody></table>
        <h3>Bookings</h3>
        <div class="table-wrap"><table><thead><tr><th>Bill No.</th><th>Date</th><th>Description</th><th>Cur.</th><th class="right">Invoice</th><th class="right">Received</th><th class="right">Balance</th><th>Status</th></tr></thead>
        <tbody>${bookingRows || '<tr><td colspan="8" class="empty">No bookings</td></tr>'}</tbody></table></div>
        <h3>Payments</h3>
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>Cur.</th><th class="right">Amount</th><th>Allocated To</th><th>Notes</th></tr></thead>
        <tbody>${paymentRows || '<tr><td colspan="5" class="empty">No payments</td></tr>'}</tbody></table></div>
      </div>`;
  }

  document.getElementById("btnPreviewStmt").addEventListener("click", function(){
    const corporateId = document.getElementById("stmtCorp").value;
    if(!corporateId){ toast("Select a corporate", true); return; }
    const data = buildStatementData(corporateId, document.getElementById("stmtFrom").value, document.getElementById("stmtTo").value);
    document.getElementById("stmtPreview").innerHTML = renderStatementPreviewHtml(data);
    document.getElementById("stmtPreviewCard").style.display = "block";
  });

  document.getElementById("btnGeneratePdf").addEventListener("click", function(){
    const corporateId = document.getElementById("stmtCorp").value;
    if(!corporateId){ toast("Select a corporate", true); return; }
    const data = buildStatementData(corporateId, document.getElementById("stmtFrom").value, document.getElementById("stmtTo").value);
    if(!data){ toast("No data", true); return; }
    generatePdf(data);
  });

  function generatePdf(data){
    if(!window.jspdf || !window.jspdf.jsPDF){ toast("PDF library not loaded (check internet connection)", true); return; }
    const {jsPDF} = window.jspdf;
    const doc = new jsPDF({unit:"pt", format:"a4"});
    const co = state.settings.company;
    const {corp, bookings, payments} = data;
    const totals = currencyTotals(bookings);

    let y = 40;
    doc.setFontSize(16); doc.setTextColor(19,39,67);
    doc.text(co.name || "Your Company", 40, y);
    doc.setFontSize(9); doc.setTextColor(100);
    y += 16;
    if(co.address){ doc.text(co.address, 40, y); y += 12; }
    const contactLine = [co.email, co.phone].filter(Boolean).join("   |   ");
    if(contactLine){ doc.text(contactLine, 40, y); y += 12; }

    doc.setFontSize(9); doc.setTextColor(100);
    doc.text("Statement Date: " + fmtDate(new Date().toISOString().slice(0,10)), 400, 40);

    y += 14;
    doc.setDrawColor(220); doc.line(40, y, 555, y); y += 20;

    doc.setFontSize(13); doc.setTextColor(19,39,67);
    doc.text("Statement of Account — " + corp.name, 40, y);
    y += 10;

    const totalsBody = Object.keys(totals).sort().map(cur=>{
      const t = totals[cur];
      return [cur, fmtMoney(t.invoiced), fmtMoney(t.received), fmtMoney(t.outstanding), fmtMoney(t.credit)];
    });
    doc.autoTable({
      startY: y+10,
      head:[["Currency","Invoiced","Received","Outstanding","Credit/Advance"]],
      body: totalsBody.length? totalsBody : [["—","—","—","—","—"]],
      styles:{fontSize:9}, headStyles:{fillColor:[19,39,67]}, margin:{left:40,right:40}
    });

    let nextY = doc.lastAutoTable.finalY + 24;
    doc.setFontSize(12); doc.setTextColor(19,39,67);
    doc.text("Bookings", 40, nextY);
    const bookingBody = bookings.map(b=>{
      const {received, balance, status} = bookingStatus(b);
      return [b.billNumber, fmtDate(b.invoiceDate), b.description||"", b.currency, fmtMoney(b.invoiceAmount), fmtMoney(received), fmtMoney(balance), statusLabel(status)];
    });
    doc.autoTable({
      startY: nextY+10,
      head:[["Bill No.","Date","Description","Cur.","Invoice","Received","Balance","Status"]],
      body: bookingBody.length? bookingBody : [["—","—","—","—","—","—","—","—"]],
      styles:{fontSize:8}, headStyles:{fillColor:[19,39,67]}, margin:{left:40,right:40}
    });

    nextY = doc.lastAutoTable.finalY + 24;
    if(nextY > 700){ doc.addPage(); nextY = 40; }
    doc.setFontSize(12); doc.setTextColor(19,39,67);
    doc.text("Payments", 40, nextY);
    const paymentBody = payments.map(p=>{
      const alloc = (p.allocations||[]).map(a=>{const b=bookingById(a.bookingId); return (b?b.billNumber:"?")+": "+fmtMoney(a.amount);}).join(", ");
      return [fmtDate(p.date), p.currency, fmtMoney(p.totalAmount), alloc||"Unallocated", p.notes||""];
    });
    doc.autoTable({
      startY: nextY+10,
      head:[["Date","Cur.","Amount","Allocated To","Notes"]],
      body: paymentBody.length? paymentBody : [["—","—","—","—","—"]],
      styles:{fontSize:8}, headStyles:{fillColor:[19,39,67]}, margin:{left:40,right:40}
    });

    const fname = `Statement_${corp.name.replace(/[^a-z0-9]+/gi,"_")}_${new Date().toISOString().slice(0,10)}.pdf`;
    doc.save(fname);
    toast("Statement downloaded");
  }

  // ================= SETTINGS =================
  document.getElementById("btnSaveCompany").addEventListener("click", function(){
    state.settings.company = {
      name: document.getElementById("setCompanyName").value.trim(),
      address: document.getElementById("setCompanyAddress").value.trim(),
      email: document.getElementById("setCompanyEmail").value.trim(),
      phone: document.getElementById("setCompanyPhone").value.trim(),
    };
    saveState();
    toast("Company info saved");
  });

  function exportJson(){
    const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `corporate-ledger-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast("JSON backup downloaded");
  }
  document.getElementById("btnExportJson").addEventListener("click", exportJson);
  document.getElementById("btnExportJson2").addEventListener("click", exportJson);

  document.getElementById("importFile").addEventListener("change", function(e){
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = function(ev){
      try{
        const parsed = JSON.parse(ev.target.result);
        if(!confirm("This will REPLACE all current data with the imported file. Continue?")) return;
        state = Object.assign(defaultState(), parsed);
        saveState();
        toast("Data imported successfully");
      }catch(err){
        toast("Invalid JSON file", true);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  document.getElementById("btnResetAll").addEventListener("click", function(){
    if(!confirm("This will permanently delete ALL corporates, bookings and payments in this browser. This cannot be undone (unless you have a backup). Continue?")) return;
    if(!confirm("Are you absolutely sure? Consider exporting a JSON backup first.")) return;
    state = defaultState();
    saveState();
    toast("All data has been reset");
  });

  // ---- GitHub backup ----
  function loadGhSettingsIntoForm(){
    const g = state.settings.github;
    document.getElementById("ghOwner").value = g.owner||"";
    document.getElementById("ghRepo").value = g.repo||"";
    document.getElementById("ghBranch").value = g.branch||"main";
    document.getElementById("ghPath").value = g.path||"data/corporate-ledger-backup.json";
    document.getElementById("ghAutoBackup").checked = !!g.autoBackup;
    document.getElementById("ghToken").value = getToken();
    updateGhStatus();
  }

  function updateGhStatus(){
    const g = state.settings.github;
    const el = document.getElementById("ghStatus");
    if(!g.owner || !g.repo){ el.textContent = "Not configured yet."; return; }
    el.textContent = `Configured: ${g.owner}/${g.repo} (${g.branch}) → ${g.path}` + (g.lastBackupAt? ` · Last backup: ${new Date(g.lastBackupAt).toLocaleString()}` : " · Never backed up yet");
  }

  document.getElementById("btnSaveGhSettings").addEventListener("click", function(){
    state.settings.github = {
      owner: document.getElementById("ghOwner").value.trim(),
      repo: document.getElementById("ghRepo").value.trim(),
      branch: document.getElementById("ghBranch").value.trim() || "main",
      path: document.getElementById("ghPath").value.trim() || "data/corporate-ledger-backup.json",
      autoBackup: document.getElementById("ghAutoBackup").checked,
      lastBackupAt: state.settings.github.lastBackupAt || ""
    };
    const token = document.getElementById("ghToken").value.trim();
    if(token) setToken(token);
    saveState({skipAutoBackup:true});
    updateGhStatus();
    toast("GitHub settings saved");
  });

  function ghHeaders(){
    return {
      "Authorization": "token " + getToken(),
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json"
    };
  }

  async function backupToGithub(opts){
    opts = opts || {};
    const g = state.settings.github;
    const token = getToken();
    if(!g.owner || !g.repo || !token){
      if(!opts.silent) toast("Please configure GitHub owner, repo and token first", true);
      return;
    }
    const el = document.getElementById("ghStatus");
    try{
      if(!opts.silent) el.textContent = "Backing up...";
      const apiUrl = `https://api.github.com/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}/contents/${g.path.split("/").map(encodeURIComponent).join("/")}`;
      let sha;
      const getResp = await fetch(apiUrl + `?ref=${encodeURIComponent(g.branch)}`, {headers: ghHeaders()});
      if(getResp.status === 200){
        const j = await getResp.json();
        sha = j.sha;
      } else if(getResp.status !== 404){
        const errText = await getResp.text();
        throw new Error(`GitHub GET failed (${getResp.status}): ${errText}`);
      }
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(state, null, 2))));
      const putResp = await fetch(apiUrl, {
        method:"PUT",
        headers: ghHeaders(),
        body: JSON.stringify({
          message: "Backup: Corporate Ledger Manager data — " + new Date().toISOString(),
          content,
          branch: g.branch,
          sha
        })
      });
      if(!putResp.ok){
        const errText = await putResp.text();
        throw new Error(`GitHub PUT failed (${putResp.status}): ${errText}`);
      }
      state.settings.github.lastBackupAt = new Date().toISOString();
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      updateGhStatus();
      if(!opts.silent) toast("Backed up to GitHub successfully");
    }catch(err){
      console.error(err);
      el.textContent = "Backup failed: " + err.message;
      if(!opts.silent) toast("GitHub backup failed — see Settings for details", true);
    }
  }

  async function restoreFromGithub(){
    const g = state.settings.github;
    const token = getToken();
    if(!g.owner || !g.repo || !token){ toast("Please configure GitHub owner, repo and token first", true); return; }
    if(!confirm("This will REPLACE all current local data with the version stored on GitHub. Continue?")) return;
    const el = document.getElementById("ghStatus");
    try{
      el.textContent = "Restoring...";
      const apiUrl = `https://api.github.com/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}/contents/${g.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(g.branch)}`;
      const resp = await fetch(apiUrl, {headers: ghHeaders()});
      if(!resp.ok){
        const errText = await resp.text();
        throw new Error(`GitHub GET failed (${resp.status}): ${errText}`);
      }
      const j = await resp.json();
      const jsonStr = decodeURIComponent(escape(atob(j.content.replace(/\n/g,""))));
      const parsed = JSON.parse(jsonStr);
      const keepGithubSettings = state.settings.github;
      state = Object.assign(defaultState(), parsed);
      state.settings.github = keepGithubSettings; // keep local connection settings
      saveState({skipAutoBackup:true});
      loadGhSettingsIntoForm();
      toast("Restored from GitHub successfully");
    }catch(err){
      console.error(err);
      el.textContent = "Restore failed: " + err.message;
      toast("GitHub restore failed — see Settings for details", true);
    }
  }

  document.getElementById("btnBackupNow").addEventListener("click", ()=>backupToGithub({silent:false}));
  document.getElementById("btnQuickBackup").addEventListener("click", ()=>backupToGithub({silent:false}));
  document.getElementById("btnRestoreGh").addEventListener("click", restoreFromGithub);

  // ================= RENDER ALL =================
  function renderAll(){
    refreshCorpDropdowns();
    renderCorporates();
    renderBookings();
    renderPayments();
    renderLedger();
    renderDashboard();
  }

  function init(){
    document.getElementById("setCompanyName").value = state.settings.company.name||"";
    document.getElementById("setCompanyAddress").value = state.settings.company.address||"";
    document.getElementById("setCompanyEmail").value = state.settings.company.email||"";
    document.getElementById("setCompanyPhone").value = state.settings.company.phone||"";
    loadGhSettingsIntoForm();
    renderAll();
  }

  // expose for inline onclick handlers
  window.CLM = {editCorporate, deleteCorporate, editBooking, deleteBooking, editPayment, deletePayment};

  document.addEventListener("DOMContentLoaded", init);
})();
