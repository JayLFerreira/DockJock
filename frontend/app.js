// ─── Theme ───────────────────────────────────────────────────────────────────
function applyTheme() {
    const theme = localStorage.getItem('theme') || 'light';
    document.body.setAttribute('data-theme', theme);
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() {
    const next = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme();
}
applyTheme(); // apply immediately before anything renders

// Global state
let isLoggedIn = false;
let authPassword = '';
let userSettings = null;
let editEntryBaseNutrition = null; // per-unit nutrition for proportional scaling

// Metrics that can be tracked (order = display order)
const ALL_METRICS = [
    { key: 'calories', label: 'Calories' },
    { key: 'protein',  label: 'Protein'  },
    { key: 'carbs',    label: 'Carbs'    },
    { key: 'fat',      label: 'Fat'      },
    { key: 'fiber',    label: 'Fiber'    },
    { key: 'water',    label: 'Water'    },
];
let trackedMetrics = new Set(['calories', 'protein', 'carbs', 'fat', 'fiber', 'water']);

// API Base URL
const API_URL = '/api';

// Water conversion
const ML_PER_CUP = 240;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

function initializeApp() {
    // Check if already logged in (session storage)
    const savedAuth = sessionStorage.getItem('authPassword');
    if (savedAuth) {
        authPassword = savedAuth;
        verifyAndLoadApp();
    } else {
        showLoginPage();
    }

    // Set up event listeners
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    document.getElementById('addFoodBtn').addEventListener('click', handleAddFood);
    document.getElementById('addManualBtn').addEventListener('click', openManualEntryModal);
    document.getElementById('saveMealBtn').addEventListener('click', handleSaveMeal);
    document.getElementById('editQuantity').addEventListener('input', handleEditQtyChange);
    document.getElementById('editQuantity').addEventListener('change', handleEditQtyChange);
    
    // Navigation
    document.querySelectorAll('.nav-links a[data-page]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = e.target.dataset.page;
            navigateToPage(page);
            if (page === 'settings') loadSettingsPage();
            if (page === 'micros') loadMicrosPage();
            if (page === 'history') loadHistoryPage();
        });
    });

    // Update current date
    updateCurrentDate();
}

function showLoginPage() {
    document.getElementById('loginPage').classList.add('active');
    document.getElementById('mainApp').classList.remove('active');
}

async function showMainApp() {
    document.getElementById('loginPage').classList.remove('active');
    document.getElementById('mainApp').classList.add('active');
    loadTrackedMetrics();
    await loadUserSettings();
    loadTodayData();
    loadSavedMeals();
    drawProgressRings();
    applyTheme();
    checkWeighInReminder();
    startMidnightWatcher();
    startNotifWatcher();
}

async function handleLogin(e) {
    e.preventDefault();
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('loginError');

    try {
        const response = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password })
        });

        const data = await response.json();

        if (data.success) {
            authPassword = password;
            sessionStorage.setItem('authPassword', password);
            isLoggedIn = true;
            showMainApp();
            errorEl.textContent = '';
        } else {
            errorEl.textContent = 'Invalid password';
        }
    } catch (error) {
        console.error('Login error:', error);
        errorEl.textContent = 'Login failed. Please try again.';
    }
}

function handleLogout() {
    sessionStorage.removeItem('authPassword');
    authPassword = '';
    isLoggedIn = false;
    userSettings = null;
    showLoginPage();
}

async function verifyAndLoadApp() {
    try {
        const response = await fetch(`${API_URL}/user/settings`, {
            headers: {
                'Authorization': 'Basic ' + btoa(':' + authPassword)
            }
        });

        if (response.ok) {
            isLoggedIn = true;
            showMainApp();
        } else {
            sessionStorage.removeItem('authPassword');
            showLoginPage();
        }
    } catch (error) {
        console.error('Verification error:', error);
        sessionStorage.removeItem('authPassword');
        showLoginPage();
    }
}

async function loadUserSettings() {
    try {
        const response = await fetch(`${API_URL}/user/settings`, {
            headers: {
                'Authorization': 'Basic ' + btoa(':' + authPassword)
            }
        });

        if (response.ok) {
            userSettings = await response.json();
            updateGoalsDisplay();
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

function updateGoalsDisplay() {
    if (!userSettings) return;

    document.getElementById('calorieGoal').textContent = userSettings.calorie_goal || 2000;
    document.getElementById('proteinGoal').textContent = userSettings.protein_goal || 150;
    document.getElementById('carbsGoal').textContent = userSettings.carbs_goal || 200;
    document.getElementById('fatGoal').textContent = userSettings.fat_goal || 65;

    const waterGoalCups = (userSettings.water_goal || 2000) / ML_PER_CUP;
    document.getElementById('waterGoal').textContent = Number.isInteger(waterGoalCups) ? waterGoalCups : waterGoalCups.toFixed(1);

    updateProfileCard();
}

function updateProfileCard() {
    const s = userSettings;
    if (!s) return;

    // Name + avatar
    const name = s.name || '';
    document.getElementById('profileName').textContent = name || 'Set up your profile';
    document.getElementById('profileAvatar').textContent = name ? name.charAt(0).toUpperCase() : '?';

    // Height
    const hEl = document.getElementById('profileHeight');
    if (s.height) {
        const { ft, inches } = cmToFtIn(s.height);
        hEl.textContent = `${ft}'${inches}"`;
    } else { hEl.textContent = '—'; }

    // Weight
    const wEl = document.getElementById('profileWeight');
    if (s.weight) {
        wEl.textContent = `${Math.round(s.weight / KG_PER_LB)} lbs`;
    } else { wEl.textContent = '—'; }

    // Goal badge
    const badge = document.getElementById('profileGoalBadge');
    const goalLabels = { lose: '📉 Lose Weight', maintain: '⚖️ Maintain', gain: '📈 Gain Muscle' };
    const goalColors = { lose: '#e74c3c', maintain: '#27ae60', gain: '#667eea' };
    if (s.goal && goalLabels[s.goal]) {
        badge.textContent = goalLabels[s.goal];
        badge.style.background = goalColors[s.goal];
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

function goToSettings() {
    navigateToPage('settings');
    loadSettingsPage();
    document.querySelector('[data-page="settings"]').classList.add('active');
}

function navigateToPage(page) {
    // Update nav links
    document.querySelectorAll('.nav-links a[data-page]').forEach(link => {
        link.classList.remove('active');
    });
    document.querySelector(`[data-page="${page}"]`).classList.add('active');

    // Update content pages
    document.querySelectorAll('.content-page').forEach(p => {
        p.classList.remove('active');
    });
    document.getElementById(`${page}Page`).classList.add('active');
}

function updateCurrentDate() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('currentDate').textContent = now.toLocaleDateString('en-US', options);
}

// Progress Ring Drawing
function drawProgressRing(canvasId, current, goal, colors, keepColor = false) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = 60;
    const lineWidth = 12;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const percentage = Math.min((current / goal) * 100, 150);
    const angle = Math.min((percentage / 100) * 2 * Math.PI, 2 * Math.PI);

    // Pick gradient colors based on percentage
    let c1, cmid, c2;
    if (!keepColor && percentage > 100) {
        c1 = '#e57373'; cmid = '#ef5350'; c2 = '#c62828';
    } else if (!keepColor && percentage > 90) {
        c1 = '#ffb74d'; cmid = '#ffa726'; c2 = '#ef6c00';
    } else {
        c1 = colors[0]; cmid = colors[2]; c2 = colors[1];
    }

    // Background circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    // Gradient for progress arc
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, c1);
    if (cmid) gradient.addColorStop(0.5, cmid);
    gradient.addColorStop(1, c2);

    // Progress arc
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + angle);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Percentage text
    const pct = Math.round((current / goal) * 100);
    ctx.fillStyle = percentage > 100 ? '#ff4444' : '#333';
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${pct}%`, centerX, centerY);
}

function drawMacroDonut(calories, fat, protein, carbs) {
    const canvas = document.getElementById('macroDonutCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const R = 58;
    const lw = 18;
    const gap = 0.05;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background ring
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 2 * Math.PI);
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = lw;
    ctx.stroke();

    const fatCals     = fat * 9;
    const proteinCals = protein * 4;
    const carbsCals   = carbs * 4;
    const total = fatCals + proteinCals + carbsCals;

    if (total > 0) {
        const segments = [
            { cals: fatCals,     color: '#ffb347' },
            { cals: proteinCals, color: '#87c5f5' },
            { cals: carbsCals,   color: '#81d4c0' },
        ];

        let startAngle = -Math.PI / 2;
        for (const seg of segments) {
            if (seg.cals <= 0) continue;
            const sweep = (seg.cals / total) * 2 * Math.PI - gap;
            ctx.beginPath();
            ctx.arc(cx, cy, R, startAngle, startAngle + sweep);
            ctx.strokeStyle = seg.color;
            ctx.lineWidth = lw;
            ctx.lineCap = 'butt';
            ctx.stroke();
            startAngle += (seg.cals / total) * 2 * Math.PI;
        }

        // Update legend percentages
        document.getElementById('donutFatPct').textContent     = Math.round(fatCals / total * 100) + '%';
        document.getElementById('donutProteinPct').textContent = Math.round(proteinCals / total * 100) + '%';
        document.getElementById('donutCarbsPct').textContent   = Math.round(carbsCals / total * 100) + '%';
    } else {
        document.getElementById('donutFatPct').textContent     = '—';
        document.getElementById('donutProteinPct').textContent = '—';
        document.getElementById('donutCarbsPct').textContent   = '—';
    }

    // Goal percentages
    const goals = userSettings || {};
    const gFatCals     = (goals.fat_goal     || 0) * 9;
    const gProteinCals = (goals.protein_goal || 0) * 4;
    const gCarbsCals   = (goals.carbs_goal   || 0) * 4;
    const gTotal = gFatCals + gProteinCals + gCarbsCals;
    if (gTotal > 0) {
        document.getElementById('goalFatPct').textContent     = Math.round(gFatCals / gTotal * 100) + '%';
        document.getElementById('goalProteinPct').textContent = Math.round(gProteinCals / gTotal * 100) + '%';
        document.getElementById('goalCarbsPct').textContent   = Math.round(gCarbsCals / gTotal * 100) + '%';
    }

    // Center: calories
    ctx.fillStyle = '#333';
    ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(calories), cx, cy - 9);
    ctx.fillStyle = '#aaa';
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('kcal', cx, cy + 11);
}

function drawProgressRings() {
    const goals = userSettings || {
        calorie_goal: 2000,
        protein_goal: 150,
        carbs_goal: 200,
        fat_goal: 65,
        fiber_goal: 30,
        water_goal: 2000
    };

    const current = window.currentTotals || { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, water: 0 };

    drawProgressRing('calorieRing', current.calories,              goals.calorie_goal,           ['#e57373', '#81c784', '#fff176']);
    drawProgressRing('proteinRing', current.protein,               goals.protein_goal,           ['#e57373', '#81c784', '#fff176']);
    drawProgressRing('carbsRing',   current.carbs,                 goals.carbs_goal,             ['#e57373', '#81c784', '#fff176']);
    drawProgressRing('fatRing',     current.fat,                   goals.fat_goal,               ['#e57373', '#81c784', '#fff176']);
    drawProgressRing('fiberRing',   current.fiber,                 goals.fiber_goal,             ['#e57373', '#81c784', '#fff176']);
    drawProgressRing('waterRing',   current.water / ML_PER_CUP,   goals.water_goal / ML_PER_CUP, ['#1a78c2', '#4facfe', '#00b4d8'], true);
    drawMacroDonut(current.calories, current.fat, current.protein, current.carbs);
}

async function loadTodayData() {
    const tzOffset = new Date().getTimezoneOffset();
    try {
        // Load food entries
        const foodResponse = await fetch(`${API_URL}/food/today?tz_offset=${tzOffset}`, {
            headers: {
                'Authorization': 'Basic ' + btoa(':' + authPassword)
            }
        });

        if (foodResponse.ok) {
            const data = await foodResponse.json();
            displayEntries(data.entries);
            updateTotals(data.totals);
        }

        // Load water
        const waterResponse = await fetch(`${API_URL}/water/today?tz_offset=${tzOffset}`, {
            headers: {
                'Authorization': 'Basic ' + btoa(':' + authPassword)
            }
        });

        if (waterResponse.ok) {
            const waterData = await waterResponse.json();
            updateWaterTotal(waterData.total);
        }
    } catch (error) {
        console.error('Error loading today data:', error);
    }
}

function updateTotals(totals) {
    window.currentTotals = totals;
    
    document.getElementById('calorieValue').textContent = Math.round(totals.calories);
    document.getElementById('proteinValue').textContent = Math.round(totals.protein);
    document.getElementById('carbsValue').textContent = Math.round(totals.carbs);
    document.getElementById('fatValue').textContent = Math.round(totals.fat);
    document.getElementById('fiberValue').textContent = Math.round(totals.fiber);
    
    drawProgressRings();
}

function updateWaterTotal(total) {
    if (!window.currentTotals) window.currentTotals = {};
    window.currentTotals.water = total;

    const cups = total / ML_PER_CUP;
    document.getElementById('waterValue').textContent = Number.isInteger(cups) ? cups : cups.toFixed(1);
    drawProgressRings();
}

function displayEntries(entries) {
    window.currentEntries = entries;
    const tbody = document.getElementById('entriesList');
    const emptyMsg = document.getElementById('entriesEmpty');
    const saveMealBtn = document.getElementById('saveMealBtn');

    if (entries.length === 0) {
        tbody.innerHTML = '';
        emptyMsg.style.display = 'block';
        saveMealBtn.style.display = 'none';
        return;
    }

    emptyMsg.style.display = 'none';
    saveMealBtn.style.display = 'block';

    tbody.innerHTML = entries.map(entry => {
        const badgeLabel = entry.source_meal || entry.meal_type;
        const badgeClass = entry.source_meal ? 'entry-meal-badge saved-meal-badge' : 'entry-meal-badge';
        return `
        <tr class="entry-row" data-entry-id="${entry.id}" data-source-meal="${entry.source_meal || ''}">
            <td class="cb-col"><input type="checkbox" class="entry-checkbox" value="${entry.id}"></td>
            <td><span class="${badgeClass}">${badgeLabel}</span></td>
            <td class="food-name-cell">${entry.food_item}</td>
            <td>${entry.quantity}</td>
            <td>${entry.unit || '—'}</td>
            <td>${Math.round(entry.calories)}</td>
            <td>${Math.round(entry.protein)}g</td>
            <td>${Math.round(entry.carbs)}g</td>
            <td>${Math.round(entry.fat)}g</td>
            <td>${Math.round(entry.fiber)}g</td>
            <td class="actions-cell">
                <button class="edit-btn" onclick="openEditModal(${entry.id})">Edit</button>
                <button class="delete-btn" onclick="deleteEntry(${entry.id})">Delete</button>
            </td>
        </tr>
    `}).join('');

    // Reset select-all checkbox
    const selectAll = document.getElementById('selectAllEntries');
    if (selectAll) selectAll.checked = false;
}

async function handleAddFood(e) {
    e.preventDefault();
    const foodInput = document.getElementById('foodInput').value;
    const mealType = document.getElementById('mealType').value;
    const statusEl = document.getElementById('addFoodStatus');
    const addBtn = document.getElementById('addFoodBtn');

    if (!foodInput.trim()) {
        statusEl.textContent = 'Please enter food items';
        statusEl.className = 'status-message error';
        return;
    }

    // Show loading with cycling messages
    const loadingMessages = [
        'Analyzing your food...',
        'Fetching nutrition data...',
        'Calculating macros...',
        'Calculating micronutrients...',
        'Almost there...'
    ];
    let loadingMsgIdx = 0;
    statusEl.style.display = '';
    statusEl.textContent = loadingMessages[0];
    statusEl.className = 'status-message loading';
    addBtn.disabled = true;
    addBtn.textContent = 'Analyzing...';
    const loadingInterval = setInterval(() => {
        loadingMsgIdx = (loadingMsgIdx + 1) % loadingMessages.length;
        statusEl.textContent = loadingMessages[loadingMsgIdx];
    }, 1800);

    try {
        const response = await fetch(`${API_URL}/food/add`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + btoa(':' + authPassword)
            },
            body: JSON.stringify({
                food_text: foodInput,
                meal_type: mealType
            })
        });

        const data = await response.json();

        if (response.ok) {
            statusEl.textContent = `✓ Added ${data.entries.length} item(s)!`;
            statusEl.className = 'status-message success';

            // Clear input
            document.getElementById('foodInput').value = '';

            // Save as meal if checkbox is checked
            const saveLater = document.getElementById('saveLaterCheckbox').checked;
            const saveLaterName = document.getElementById('saveLaterName').value.trim();
            if (saveLater && saveLaterName && data.entries && data.entries.length > 0) {
                try {
                    await fetch(`${API_URL}/meals/save`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Basic ' + btoa(':' + authPassword)
                        },
                        body: JSON.stringify({
                            name: saveLaterName,
                            meal_type: mealType,
                            entry_ids: data.entries.map(e => e.id)
                        })
                    });
                    statusEl.textContent = `✓ Added ${data.entries.length} item(s) and saved as "${saveLaterName}"!`;
                } catch (err) {
                    console.error('Error saving meal:', err);
                }
                document.getElementById('saveLaterCheckbox').checked = false;
                document.getElementById('saveLaterName').value = '';
                document.getElementById('saveLaterName').style.display = 'none';
            }

            // Reload data
            await loadTodayData();
            loadSavedMeals();

            // Clear success message after 3 seconds
            setTimeout(() => {
                statusEl.style.display = 'none';
            }, 3000);
        } else {
            statusEl.textContent = `Error: ${data.detail || 'Failed to add food'}`;
            statusEl.className = 'status-message error';
        }
    } catch (error) {
        console.error('Error adding food:', error);
        statusEl.textContent = 'Error: Could not connect to server';
        statusEl.className = 'status-message error';
    } finally {
        clearInterval(loadingInterval);
        addBtn.disabled = false;
        addBtn.textContent = 'Add Entry';
    }
}

// ── Manual Entry Modal ──────────────────────────────────────────────────────

function openManualEntryModal() {
    document.getElementById('meFoodName').value = '';
    document.getElementById('meQty').value = '1';
    document.getElementById('meUnit').value = '';
    document.getElementById('meCalories').value = '0';
    document.getElementById('meProtein').value = '0';
    document.getElementById('meCarbs').value = '0';
    document.getElementById('meFat').value = '0';
    document.getElementById('meFiber').value = '0';
    document.getElementById('meSugar').value = '0';
    document.getElementById('meStatus').className = 'status-message';
    document.getElementById('meStatus').textContent = '';
    document.getElementById('manualEntryModal').style.display = 'flex';
}

function closeManualEntryModal() {
    document.getElementById('manualEntryModal').style.display = 'none';
}

function closeManualEntryModalOutside(e) {
    if (e.target === document.getElementById('manualEntryModal')) closeManualEntryModal();
}

async function submitManualEntry() {
    const foodName = document.getElementById('meFoodName').value.trim();
    const statusEl = document.getElementById('meStatus');

    if (!foodName) {
        statusEl.textContent = 'Please enter a food name.';
        statusEl.className = 'status-message error';
        return;
    }

    const payload = {
        food_name: foodName,
        quantity: parseFloat(document.getElementById('meQty').value) || 1,
        unit: document.getElementById('meUnit').value.trim() || 'serving',
        meal_type: document.getElementById('meMealType').value,
        calories: parseFloat(document.getElementById('meCalories').value) || 0,
        protein: parseFloat(document.getElementById('meProtein').value) || 0,
        carbs: parseFloat(document.getElementById('meCarbs').value) || 0,
        fat: parseFloat(document.getElementById('meFat').value) || 0,
        fiber: parseFloat(document.getElementById('meFiber').value) || 0,
        sugar: parseFloat(document.getElementById('meSugar').value) || 0,
    };

    statusEl.textContent = 'Saving...';
    statusEl.className = 'status-message loading';

    try {
        const response = await fetch(`${API_URL}/food/add-manual`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + btoa(':' + authPassword)
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (response.ok) {
            closeManualEntryModal();
            await loadTodayData();
        } else {
            statusEl.textContent = `Error: ${data.detail || 'Failed to save'}`;
            statusEl.className = 'status-message error';
        }
    } catch (err) {
        statusEl.textContent = 'Error: Could not connect to server';
        statusEl.className = 'status-message error';
    }
}

// ── Micronutrients Page ─────────────────────────────────────────────────────

const MICRO_RDA = [
    { key: 'vitamin_a_mcg',           label: 'Vitamin A',      rda: 900,  unit: 'mcg', group: 'Vitamins' },
    { key: 'vitamin_c_mg',            label: 'Vitamin C',      rda: 90,   unit: 'mg',  group: 'Vitamins' },
    { key: 'vitamin_d_mcg',           label: 'Vitamin D',      rda: 15,   unit: 'mcg', group: 'Vitamins' },
    { key: 'vitamin_e_mg',            label: 'Vitamin E',      rda: 15,   unit: 'mg',  group: 'Vitamins' },
    { key: 'vitamin_k_mcg',           label: 'Vitamin K',      rda: 120,  unit: 'mcg', group: 'Vitamins' },
    { key: 'vitamin_b1_thiamin_mg',   label: 'B1 Thiamin',     rda: 1.2,  unit: 'mg',  group: 'Vitamins' },
    { key: 'vitamin_b2_riboflavin_mg',label: 'B2 Riboflavin',  rda: 1.3,  unit: 'mg',  group: 'Vitamins' },
    { key: 'vitamin_b3_niacin_mg',    label: 'B3 Niacin',      rda: 16,   unit: 'mg',  group: 'Vitamins' },
    { key: 'vitamin_b6_mg',           label: 'Vitamin B6',     rda: 1.3,  unit: 'mg',  group: 'Vitamins' },
    { key: 'vitamin_b12_mcg',         label: 'Vitamin B12',    rda: 2.4,  unit: 'mcg', group: 'Vitamins' },
    { key: 'folate_mcg',              label: 'Folate',         rda: 400,  unit: 'mcg', group: 'Vitamins' },
    { key: 'choline_mg',              label: 'Choline',        rda: 550,  unit: 'mg',  group: 'Vitamins' },
    { key: 'calcium_mg',              label: 'Calcium',        rda: 1000, unit: 'mg',  group: 'Minerals' },
    { key: 'iron_mg',                 label: 'Iron',           rda: 8,    unit: 'mg',  group: 'Minerals' },
    { key: 'magnesium_mg',            label: 'Magnesium',      rda: 420,  unit: 'mg',  group: 'Minerals' },
    { key: 'phosphorus_mg',           label: 'Phosphorus',     rda: 700,  unit: 'mg',  group: 'Minerals' },
    { key: 'potassium_mg',            label: 'Potassium',      rda: 3400, unit: 'mg',  group: 'Minerals' },
    { key: 'sodium_mg',               label: 'Sodium',         rda: 2300, unit: 'mg',  group: 'Minerals', upperLimit: true },
    { key: 'zinc_mg',                 label: 'Zinc',           rda: 11,   unit: 'mg',  group: 'Minerals' },
    { key: 'copper_mg',               label: 'Copper',         rda: 0.9,  unit: 'mg',  group: 'Minerals' },
    { key: 'manganese_mg',            label: 'Manganese',      rda: 2.3,  unit: 'mg',  group: 'Minerals' },
    { key: 'selenium_mcg',            label: 'Selenium',       rda: 55,   unit: 'mcg', group: 'Minerals' },
];

let microsPeriod = 'today';
let microsCurrentTotals = {};

async function loadMicrosPage(period) {
    if (period) microsPeriod = period;
    const container = document.getElementById('microsContent');
    const dateEl = document.getElementById('microsDate');
    const titleEl = document.getElementById('microsTitle');

    // Update toggle state
    document.getElementById('microsTodayBtn').classList.toggle('active', microsPeriod === 'today');
    document.getElementById('microsWeekBtn').classList.toggle('active', microsPeriod === 'week');

    // Clear analysis when switching periods
    document.getElementById('microsAnalysis').style.display = 'none';

    let entries, rdaMultiplier;

    if (microsPeriod === 'today') {
        entries = window.currentEntries || [];
        rdaMultiplier = 1;
        titleEl.textContent = "Today's Micronutrients";
        const now = new Date();
        dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    } else {
        titleEl.textContent = "Weekly Micronutrients";
        dateEl.textContent = "7-day totals vs. weekly goal (7× RDA)";
        container.innerHTML = '<p class="micros-empty">Loading...</p>';
        try {
            const tzOffset = new Date().getTimezoneOffset();
            const res = await fetch(`${API_URL}/food/week?tz_offset=${tzOffset}`, {
                headers: { 'Authorization': 'Basic ' + btoa(':' + authPassword) }
            });
            const data = await res.json();
            entries = data.entries;
            rdaMultiplier = data.days;
        } catch {
            container.innerHTML = '<p class="micros-empty">Error loading weekly data.</p>';
            return;
        }
    }

    if (entries.length === 0) {
        container.innerHTML = `<p class="micros-empty">No food logged. Add entries to see micronutrient data.</p>`;
        return;
    }

    // Aggregate totals
    const totals = {};
    entries.forEach(entry => {
        let micros = {};
        try { micros = JSON.parse(entry.micros_json || '{}'); } catch {}
        Object.entries(micros).forEach(([k, v]) => {
            totals[k] = (totals[k] || 0) + (v || 0);
        });
    });
    microsCurrentTotals = { ...totals };

    // Build HTML
    const groups = ['Vitamins', 'Minerals'];
    let html = '';
    groups.forEach(group => {
        html += `<div class="micros-group"><h3 class="micros-group-title">${group}</h3><div class="micros-list">`;
        MICRO_RDA.filter(m => m.group === group).forEach(micro => {
            const amount = totals[micro.key] || 0;
            const goal = micro.rda * rdaMultiplier;
            const rawPct = (amount / goal) * 100;
            const barPct = Math.min(rawPct, 100);
            const displayPct = rawPct >= 10 ? Math.round(rawPct) : rawPct.toFixed(1);
            const displayAmt = amount < 10 ? amount.toFixed(1) : Math.round(amount);
            const displayGoal = goal < 10 ? goal.toFixed(1) : Math.round(goal);
            let barClass, pctColor;
            if (micro.upperLimit) {
                barClass = barPct < 80 ? 'micros-bar-good' : barPct < 100 ? 'micros-bar-warn' : 'micros-bar-over';
                pctColor = barPct < 80 ? '#27ae60' : barPct < 100 ? '#e67e22' : '#e74c3c';
            } else {
                barClass = barPct >= 90 ? 'micros-bar-good' : barPct >= 30 ? 'micros-bar-warn' : 'micros-bar-low';
                pctColor = barPct >= 90 ? '#27ae60' : barPct >= 30 ? '#e67e22' : '#e74c3c';
            }
            html += `
                <div class="micros-row">
                    <span class="micros-label">${micro.label}</span>
                    <div class="micros-bar-wrap">
                        <div class="micros-bar ${barClass}" style="width:${barPct}%"></div>
                    </div>
                    <span class="micros-pct" style="color:${pctColor}">${displayPct}%</span>
                    <span class="micros-amount">${displayAmt} / ${displayGoal} ${micro.unit}</span>
                </div>`;
        });
        html += '</div></div>';
    });
    container.innerHTML = html;
}

async function analyzeMicros() {
    const btn = document.getElementById('analyzeBtn');
    const analysisEl = document.getElementById('microsAnalysis');

    if (Object.keys(microsCurrentTotals).length === 0) {
        analysisEl.innerHTML = '<div class="analysis-card analysis-empty">Log some food first to analyze your micronutrients.</div>';
        analysisEl.style.display = 'block';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Analyzing...';
    analysisEl.innerHTML = '<div class="analysis-card analysis-loading">Analyzing your micronutrient intake...</div>';
    analysisEl.style.display = 'block';

    try {
        const response = await fetch(`${API_URL}/micros/analyze`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + btoa(':' + authPassword)
            },
            body: JSON.stringify({
                period: microsPeriod,
                days: microsPeriod === 'week' ? 7 : 1,
                micros: microsCurrentTotals
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.detail);

        let html = `<div class="analysis-card">
            <div class="analysis-summary">${data.summary}</div>`;

        if (data.deficiencies && data.deficiencies.length > 0) {
            html += `<div class="analysis-section-title">Top Deficiencies</div>`;
            data.deficiencies.forEach(d => {
                html += `<div class="analysis-deficiency">
                    <div class="analysis-def-header">
                        <span class="analysis-nutrient">${d.nutrient}</span>
                        <span class="analysis-pct">${d.pct_of_rda}% of RDA</span>
                    </div>
                    <div class="analysis-foods">Eat more: ${d.foods.join(', ')}</div>
                </div>`;
            });
        }

        if (data.strengths && data.strengths.length > 0) {
            html += `<div class="analysis-section-title">Strengths</div>
                <ul class="analysis-strengths">
                    ${data.strengths.map(s => `<li>${s}</li>`).join('')}
                </ul>`;
        }

        html += '</div>';
        analysisEl.innerHTML = html;
    } catch (err) {
        analysisEl.innerHTML = `<div class="analysis-card analysis-error">Error: ${err.message || 'Could not analyze'}</div>`;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Analyze Weaknesses';
    }
}

let pendingDeleteEntryId = null;

function deleteEntry(entryId) {
    const entry = (window.currentEntries || []).find(e => e.id === entryId);
    const name = entry ? entry.food_item : 'this entry';
    document.getElementById('deleteEntryText').textContent = `Remove "${name}" from today's log?`;
    pendingDeleteEntryId = entryId;
    document.getElementById('deleteEntryModal').style.display = 'flex';
}

function closeDeleteEntryModal() {
    document.getElementById('deleteEntryModal').style.display = 'none';
    pendingDeleteEntryId = null;
}

function closeDeleteEntryModalOutside(e) {
    if (e.target === document.getElementById('deleteEntryModal')) closeDeleteEntryModal();
}

async function confirmDeleteEntry() {
    if (!pendingDeleteEntryId) return;
    const id = pendingDeleteEntryId;
    closeDeleteEntryModal();
    try {
        const response = await fetch(`${API_URL}/food/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': 'Basic ' + btoa(':' + authPassword) }
        });
        if (response.ok) await loadTodayData();
    } catch (error) {
        console.error('Error deleting entry:', error);
    }
}

async function addWater(amount) {
    try {
        const response = await fetch(`${API_URL}/water/add`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + btoa(':' + authPassword)
            },
            body: JSON.stringify({ amount })
        });

        if (response.ok) {
            const waterResponse = await fetch(`${API_URL}/water/today?tz_offset=${new Date().getTimezoneOffset()}`, {
                headers: {
                    'Authorization': 'Basic ' + btoa(':' + authPassword)
                }
            });
            
            if (waterResponse.ok) {
                const data = await waterResponse.json();
                updateWaterTotal(data.total);
            }
        }
    } catch (error) {
        console.error('Error adding water:', error);
    }
}

function handleSaveMeal() {
    openSaveMealModal();
}

function openSaveMealModal() {
    const checked = document.querySelectorAll('.entry-checkbox:checked');
    const total   = document.querySelectorAll('.entry-checkbox');
    const subtext = document.getElementById('saveMealSubtext');

    if (checked.length > 0) {
        subtext.textContent = `Saving ${checked.length} selected item${checked.length > 1 ? 's' : ''}.`;
    } else {
        subtext.textContent = `No items selected — all ${total.length} entries will be saved.`;
    }

    document.getElementById('saveMealNameInput').value = '';
    document.getElementById('saveMealModal').style.display = 'flex';
    setTimeout(() => document.getElementById('saveMealNameInput').focus(), 50);
}

function closeSaveMealModal() {
    document.getElementById('saveMealModal').style.display = 'none';
}

function closeSaveMealModalOutside(event) {
    if (event.target === document.getElementById('saveMealModal')) {
        closeSaveMealModal();
    }
}

async function confirmSaveMeal() {
    const name = document.getElementById('saveMealNameInput').value.trim();
    if (!name) {
        document.getElementById('saveMealNameInput').focus();
        return;
    }

    const mealType = document.getElementById('mealType').value;

    // Use checked items, or all if none selected
    const checked = document.querySelectorAll('.entry-checkbox:checked');
    const source  = checked.length > 0
        ? checked
        : document.querySelectorAll('.entry-checkbox');
    const entryIds = Array.from(source).map(cb => parseInt(cb.value));

    if (entryIds.length === 0) return;

    try {
        const response = await fetch(`${API_URL}/meals/save`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + btoa(':' + authPassword)
            },
            body: JSON.stringify({ name, meal_type: mealType, entry_ids: entryIds })
        });

        if (response.ok) {
            closeSaveMealModal();
            loadSavedMeals();
        } else {
            alert('Failed to save meal');
        }
    } catch (error) {
        console.error('Error saving meal:', error);
        alert('Failed to save meal');
    }
}

function toggleAllEntries(checkbox) {
    document.querySelectorAll('.entry-checkbox').forEach(cb => {
        cb.checked = checkbox.checked;
    });
}

async function loadSavedMeals() {
    try {
        const response = await fetch(`${API_URL}/meals/list`, {
            headers: {
                'Authorization': 'Basic ' + btoa(':' + authPassword)
            }
        });

        if (response.ok) {
            const data = await response.json();
            displaySavedMeals(data.meals);
        }
    } catch (error) {
        console.error('Error loading saved meals:', error);
    }
}

// Store full meal data (with items) for the builder
window.savedMealsData = [];

function displaySavedMeals(meals) {
    window.savedMealsData = meals;
    const mealsList = document.getElementById('savedMealsList');

    if (meals.length === 0) {
        mealsList.innerHTML = '<p style="color: #999;">No saved meals yet. Use + Create to build one!</p>';
        return;
    }

    mealsList.innerHTML = meals.map(meal => `
        <div class="saved-meal-card">
            <div class="saved-meal-main" onclick="openLoadMealModal(${meal.id}, '${meal.name.replace(/'/g, "\\'")}')">
                <div class="saved-meal-name">${meal.name}</div>
                <div class="saved-meal-info">
                    ${meal.meal_type} • ${Math.round(meal.calories)} cal<br>
                    P: ${Math.round(meal.protein)}g | C: ${Math.round(meal.carbs)}g | F: ${Math.round(meal.fat)}g
                </div>
            </div>
            <div class="saved-meal-actions">
                <button class="edit-btn" onclick="openMealBuilder(${meal.id})">Edit</button>
                <button class="delete-btn" onclick="deleteSavedMeal(${meal.id}, '${meal.name.replace(/'/g, "\\'")}')">Delete</button>
            </div>
        </div>
    `).join('');
}

let pendingLoadMealId = null;

function openLoadMealModal(mealId, mealName) {
    pendingLoadMealId = mealId;
    document.getElementById('loadMealConfirmText').textContent =
        `Add "${mealName}" entries to today's log?`;
    document.getElementById('loadMealModal').style.display = 'flex';
}

function closeLoadMealModal() {
    document.getElementById('loadMealModal').style.display = 'none';
    pendingLoadMealId = null;
}

function closeLoadMealModalOutside(event) {
    if (event.target === document.getElementById('loadMealModal')) {
        closeLoadMealModal();
    }
}

async function confirmLoadMeal() {
    if (!pendingLoadMealId) return;
    const mealId = pendingLoadMealId;
    closeLoadMealModal();

    try {
        const response = await fetch(`${API_URL}/meals/load/${mealId}`, {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa(':' + authPassword)
            }
        });

        if (response.ok) {
            await loadTodayData();
        }
    } catch (error) {
        console.error('Error loading saved meal:', error);
    }
}

// --- Save Later Checkbox ---

function toggleSaveLaterName() {
    const checkbox = document.getElementById('saveLaterCheckbox');
    const nameInput = document.getElementById('saveLaterName');
    nameInput.style.display = checkbox.checked ? 'block' : 'none';
    if (checkbox.checked) nameInput.focus();
}

// --- Edit Entry Modal ---

function openEditModal(entryId) {
    const entry = (window.currentEntries || []).find(e => e.id === entryId);
    if (!entry) return;

    // Store per-unit nutrition so qty changes can scale proportionally
    const qty = entry.quantity || 1;
    editEntryBaseNutrition = {
        calories: entry.calories / qty,
        protein:  entry.protein  / qty,
        carbs:    entry.carbs    / qty,
        fat:      entry.fat      / qty,
        fiber:    entry.fiber    / qty,
    };

    document.getElementById('editEntryId').value    = entryId;
    document.getElementById('editFoodName').value   = entry.food_item;
    document.getElementById('editQuantity').value   = entry.quantity;
    document.getElementById('editUnit').value       = entry.unit || '';
    document.getElementById('editCalories').value   = round1(entry.calories);
    document.getElementById('editProtein').value    = round1(entry.protein);
    document.getElementById('editCarbs').value      = round1(entry.carbs);
    document.getElementById('editFat').value        = round1(entry.fat);
    document.getElementById('editFiber').value      = round1(entry.fiber);

    document.getElementById('editModal').style.display = 'flex';
}

function round1(n) { return Math.round(n * 10) / 10; }

function handleEditQtyChange() {
    if (!editEntryBaseNutrition) return;
    const qty = parseFloat(document.getElementById('editQuantity').value);
    if (!qty || qty <= 0) return;

    document.getElementById('editCalories').value = round1(editEntryBaseNutrition.calories * qty);
    document.getElementById('editProtein').value  = round1(editEntryBaseNutrition.protein  * qty);
    document.getElementById('editCarbs').value    = round1(editEntryBaseNutrition.carbs    * qty);
    document.getElementById('editFat').value      = round1(editEntryBaseNutrition.fat      * qty);
    document.getElementById('editFiber').value    = round1(editEntryBaseNutrition.fiber    * qty);
}

function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
}

function closeEditModalOutside(event) {
    if (event.target === document.getElementById('editModal')) {
        closeEditModal();
    }
}

async function saveEditEntry() {
    const entryId = document.getElementById('editEntryId').value;
    const data = {
        food_name: document.getElementById('editFoodName').value,
        quantity: parseFloat(document.getElementById('editQuantity').value),
        unit: document.getElementById('editUnit').value,
        calories: parseFloat(document.getElementById('editCalories').value),
        protein: parseFloat(document.getElementById('editProtein').value),
        carbs: parseFloat(document.getElementById('editCarbs').value),
        fat: parseFloat(document.getElementById('editFat').value),
        fiber: parseFloat(document.getElementById('editFiber').value),
    };

    try {
        const response = await fetch(`${API_URL}/food/${entryId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + btoa(':' + authPassword)
            },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            closeEditModal();
            await loadTodayData();
        } else {
            alert('Failed to update entry');
        }
    } catch (error) {
        console.error('Error updating entry:', error);
        alert('Failed to update entry');
    }
}

// --- Tracked Metrics (which rings to show) ---

function loadTrackedMetrics() {
    const saved = localStorage.getItem('trackedMetrics');
    if (saved) {
        trackedMetrics = new Set(JSON.parse(saved));
    }
    applyTrackedMetrics();
}

function applyTrackedMetrics() {
    ALL_METRICS.forEach(({ key }) => {
        const el = document.querySelector(`.ring-item[data-metric="${key}"]`);
        if (el) {
            el.style.display = trackedMetrics.has(key) ? '' : 'none';
        }
    });
}

function toggleCustomizePanel() {
    const panel = document.getElementById('customizePanel');
    if (panel.style.display === 'none' || panel.style.display === '') {
        renderMetricsChecklist();
        panel.style.display = 'block';
    } else {
        panel.style.display = 'none';
    }
}

function closeCustomizePanel() {
    document.getElementById('customizePanel').style.display = 'none';
}

function renderMetricsChecklist() {
    const container = document.getElementById('metricsChecklist');
    container.innerHTML = ALL_METRICS.map(({ key, label }) => `
        <label class="metric-checkbox-item">
            <input type="checkbox" ${trackedMetrics.has(key) ? 'checked' : ''}
                   onchange="saveMetricPreference('${key}', this.checked)">
            <span>${label}</span>
        </label>
    `).join('');
}

function saveMetricPreference(key, checked) {
    if (checked) {
        trackedMetrics.add(key);
    } else {
        trackedMetrics.delete(key);
    }
    localStorage.setItem('trackedMetrics', JSON.stringify([...trackedMetrics]));
    applyTrackedMetrics();
    drawProgressRings();
}

// ─── Settings Page ────────────────────────────────────────────────────────────

const CM_PER_INCH = 2.54;
const IN_PER_FOOT = 12;
const KG_PER_LB   = 0.453592;

function cmToFtIn(cm) {
    const totalIn = cm / CM_PER_INCH;
    const ft = Math.floor(totalIn / IN_PER_FOOT);
    const inches = Math.round(totalIn % IN_PER_FOOT);
    return { ft, inches };
}

function ftInToCm(ft, inches) {
    return ((ft * IN_PER_FOOT) + inches) * CM_PER_INCH;
}

function loadSettingsPage() {
    if (!userSettings) return;
    const s = userSettings;

    document.getElementById('setName').value = s.name || '';
    document.getElementById('setCalorieGoal').value = s.calorie_goal || 2000;
    document.getElementById('setProteinGoal').value = s.protein_goal || 150;
    document.getElementById('setCarbsGoal').value   = s.carbs_goal   || 200;
    document.getElementById('setFatGoal').value     = s.fat_goal     || 65;
    document.getElementById('setFiberGoal').value   = s.fiber_goal   || 30;
    document.getElementById('setWaterGoal').value   = Math.round((s.water_goal || 2000) / ML_PER_CUP * 2) / 2;

    if (s.height) {
        const { ft, inches } = cmToFtIn(s.height);
        document.getElementById('setHeightFt').value = ft;
        document.getElementById('setHeightIn').value = inches;
    }
    if (s.weight) {
        document.getElementById('setWeight').value = Math.round(s.weight / KG_PER_LB * 10) / 10;
    }

    const modelSelect = document.getElementById('setOpenAIModel');
    if (s.openai_model) modelSelect.value = s.openai_model;

    document.getElementById('setWeighInDay').value = s.weigh_in_day ?? 0;
    loadNotifPrefs();
}

function showSettingsStatus(id, msg, isError = false) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.style.color = isError ? '#e74c3c' : '#27ae60';
    setTimeout(() => { el.textContent = ''; }, 3000);
}

async function saveProfile() {
    const name = document.getElementById('setName').value.trim();
    try {
        const res = await fetch(`${API_URL}/user/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + btoa(':' + authPassword) },
            body: JSON.stringify({ name })
        });
        if (res.ok) {
            await loadUserSettings();
            showSettingsStatus('profileStatus', '✓ Saved');
        } else {
            showSettingsStatus('profileStatus', 'Save failed', true);
        }
    } catch { showSettingsStatus('profileStatus', 'Error', true); }
}

async function saveMacroGoals() {
    const payload = {
        calorie_goal: parseFloat(document.getElementById('setCalorieGoal').value),
        protein_goal: parseFloat(document.getElementById('setProteinGoal').value),
        carbs_goal:   parseFloat(document.getElementById('setCarbsGoal').value),
        fat_goal:     parseFloat(document.getElementById('setFatGoal').value),
        fiber_goal:   parseFloat(document.getElementById('setFiberGoal').value),
        water_goal:   parseFloat(document.getElementById('setWaterGoal').value) * ML_PER_CUP,
    };
    try {
        const res = await fetch(`${API_URL}/user/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + btoa(':' + authPassword) },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            await loadUserSettings();
            drawProgressRings();
            showSettingsStatus('macroGoalStatus', '✓ Saved');
        } else {
            showSettingsStatus('macroGoalStatus', 'Save failed', true);
        }
    } catch { showSettingsStatus('macroGoalStatus', 'Error', true); }
}

async function saveBodyStats() {
    const ft      = parseFloat(document.getElementById('setHeightFt').value) || 0;
    const inches  = parseFloat(document.getElementById('setHeightIn').value) || 0;
    const weightLb = parseFloat(document.getElementById('setWeight').value);
    const weighInDay = parseInt(document.getElementById('setWeighInDay').value);
    const payload = {
        height: ftInToCm(ft, inches),
        weight: weightLb * KG_PER_LB,
        weigh_in_day: weighInDay,
    };
    try {
        const res = await fetch(`${API_URL}/user/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + btoa(':' + authPassword) },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            await loadUserSettings();
            showSettingsStatus('bodyStatStatus', '✓ Saved');
        } else {
            showSettingsStatus('bodyStatStatus', 'Save failed', true);
        }
    } catch { showSettingsStatus('bodyStatStatus', 'Error', true); }
}

async function changePassword() {
    const current  = document.getElementById('currentPassword').value;
    const newPw    = document.getElementById('newPassword').value;
    const confirm  = document.getElementById('confirmPassword').value;

    if (!current || !newPw) { showSettingsStatus('passwordStatus', 'Fill in all fields', true); return; }
    if (newPw !== confirm)  { showSettingsStatus('passwordStatus', 'Passwords do not match', true); return; }

    try {
        const params = new URLSearchParams({ current_password: current, new_password: newPw });
        const res = await fetch(`${API_URL}/user/change-password?${params}`, {
            method: 'POST',
            headers: { 'Authorization': 'Basic ' + btoa(':' + authPassword) }
        });
        if (res.ok) {
            authPassword = newPw;
            sessionStorage.setItem('authPassword', newPw);
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmPassword').value = '';
            showSettingsStatus('passwordStatus', '✓ Password changed');
        } else {
            const data = await res.json();
            showSettingsStatus('passwordStatus', data.detail || 'Incorrect current password', true);
        }
    } catch { showSettingsStatus('passwordStatus', 'Error', true); }
}

async function saveAIModel() {
    const model = document.getElementById('setOpenAIModel').value;
    try {
        const res = await fetch(`${API_URL}/user/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + btoa(':' + authPassword) },
            body: JSON.stringify({ openai_model: model })
        });
        if (res.ok) {
            await loadUserSettings();
            showSettingsStatus('aiModelStatus', '✓ Saved');
        } else {
            showSettingsStatus('aiModelStatus', 'Save failed', true);
        }
    } catch { showSettingsStatus('aiModelStatus', 'Error', true); }
}

async function clearFoodCache() {
    const query = document.getElementById('cacheClearQuery').value.trim();
    const url = `${API_URL}/cache/clear${query ? '?query=' + encodeURIComponent(query) : ''}`;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': 'Basic ' + btoa(':' + authPassword) }
        });
        if (res.ok) {
            const data = await res.json();
            showSettingsStatus('cacheStatus', `✓ Cleared ${data.deleted} item(s)`);
            document.getElementById('cacheClearQuery').value = '';
        } else {
            showSettingsStatus('cacheStatus', 'Failed', true);
        }
    } catch { showSettingsStatus('cacheStatus', 'Error', true); }
}

// ─── Macro Wizard ─────────────────────────────────────────────────────────────

let wizardStep = 1;
let wizardSex      = 'male';
let wizardGoal     = null;
let wizardActivity = null;
let wizardActivityMultiplier = 1.2;

function openMacroWizard() {
    wizardStep = 1;
    wizardGoal = null;
    wizardActivity = null;
    wizardSex = 'male';

    // Pre-populate with saved body stats if available
    if (userSettings) {
        if (userSettings.height) {
            const { ft, inches } = cmToFtIn(userSettings.height);
            document.getElementById('wizardFt').value = ft;
            document.getElementById('wizardIn').value = inches;
        }
        if (userSettings.weight) {
            document.getElementById('wizardWeight').value =
                Math.round(userSettings.weight / KG_PER_LB * 10) / 10;
        }
    }

    selectSex('male');
    showWizardStep(1);
    document.getElementById('macroWizard').style.display = 'flex';
}

function closeMacroWizard() {
    document.getElementById('macroWizard').style.display = 'none';
}

function closeMacroWizardOutside(event) {
    if (event.target === document.getElementById('macroWizard')) closeMacroWizard();
}

function showWizardStep(step) {
    wizardStep = step;
    [1,2,3,4].forEach(i => {
        document.getElementById(`wizardStep${i}`).style.display = i === step ? '' : 'none';
    });
    document.getElementById('wizardTitle').textContent = `Macro Wizard — Step ${Math.min(step, 3)} of 3`;
    document.getElementById('wizardBackBtn').style.display = step > 1 ? '' : 'none';

    const nextBtn = document.getElementById('wizardNextBtn');
    if (step === 4) {
        nextBtn.textContent = 'Apply These Goals';
        nextBtn.onclick = applyWizardMacros;
    } else {
        nextBtn.textContent = 'Next →';
        nextBtn.onclick = wizardNext;
    }
}

function selectSex(sex) {
    wizardSex = sex;
    document.getElementById('sexMale').classList.toggle('active', sex === 'male');
    document.getElementById('sexFemale').classList.toggle('active', sex === 'female');
}

function selectGoal(goal) {
    wizardGoal = goal;
    ['lose','maintain','gain'].forEach(g => {
        document.getElementById(`goal${g.charAt(0).toUpperCase()+g.slice(1)}`).classList.toggle('selected', g === goal);
    });
}

function selectActivity(key, multiplier) {
    wizardActivity = key;
    wizardActivityMultiplier = multiplier;
    ['Sedentary','Light','Moderate','Very','Extreme'].forEach(k => {
        document.getElementById(`act${k}`).classList.toggle('selected', k.toLowerCase() === key);
    });
}

function wizardNext() {
    if (wizardStep === 1) {
        const age = parseFloat(document.getElementById('wizardAge').value);
        const ft  = parseFloat(document.getElementById('wizardFt').value);
        const wt  = parseFloat(document.getElementById('wizardWeight').value);
        if (!age || !ft || !wt) { alert('Please fill in all fields.'); return; }
    }
    if (wizardStep === 2 && !wizardGoal) { alert('Please select a goal.'); return; }
    if (wizardStep === 3) {
        if (!wizardActivity) { alert('Please select an activity level.'); return; }
        calculateWizardMacros();
        showWizardStep(4);
        return;
    }
    showWizardStep(wizardStep + 1);
}

function wizardBack() {
    if (wizardStep > 1) showWizardStep(wizardStep - 1);
}

function calculateWizardMacros() {
    const age      = parseFloat(document.getElementById('wizardAge').value);
    const ft       = parseFloat(document.getElementById('wizardFt').value) || 0;
    const inches   = parseFloat(document.getElementById('wizardIn').value) || 0;
    const weightLb = parseFloat(document.getElementById('wizardWeight').value);
    const heightCm = ftInToCm(ft, inches);
    const weightKg = weightLb * KG_PER_LB;

    // Mifflin-St Jeor BMR
    const bmr = wizardSex === 'male'
        ? (10 * weightKg) + (6.25 * heightCm) - (5 * age) + 5
        : (10 * weightKg) + (6.25 * heightCm) - (5 * age) - 161;

    let tdee = Math.round(bmr * wizardActivityMultiplier);

    // Goal adjustment
    if (wizardGoal === 'lose')     tdee -= 500;
    if (wizardGoal === 'gain')     tdee += 300;

    // Macro splits (protein g/kg basis + remaining from carbs/fat)
    let proteinPct, carbsPct, fatPct;
    if (wizardGoal === 'lose') {
        proteinPct = 0.40; carbsPct = 0.35; fatPct = 0.25;
    } else if (wizardGoal === 'gain') {
        proteinPct = 0.30; carbsPct = 0.45; fatPct = 0.25;
    } else {
        proteinPct = 0.30; carbsPct = 0.40; fatPct = 0.30;
    }

    const protein = Math.round((tdee * proteinPct) / 4);
    const carbs   = Math.round((tdee * carbsPct)   / 4);
    const fat     = Math.round((tdee * fatPct)      / 9);
    const fiber   = Math.round(tdee / 1000 * 14);   // 14g per 1000 kcal
    const waterCups = Math.round(weightKg * 0.033 / (ML_PER_CUP / 1000) * 2) / 2; // 33ml/kg → cups

    document.getElementById('wCalories').textContent = `${tdee} kcal`;
    document.getElementById('wProtein').textContent  = `${protein} g`;
    document.getElementById('wCarbs').textContent    = `${carbs} g`;
    document.getElementById('wFat').textContent      = `${fat} g`;
    document.getElementById('wFiber').textContent    = `${fiber} g`;
    document.getElementById('wWater').textContent    = `${waterCups} cups`;

    // Store for apply
    window._wizardResult = { tdee, protein, carbs, fat, fiber, waterCups };
}

async function applyWizardMacros() {
    const r = window._wizardResult;
    if (!r) return;

    // Populate settings fields
    document.getElementById('setCalorieGoal').value = r.tdee;
    document.getElementById('setProteinGoal').value = r.protein;
    document.getElementById('setCarbsGoal').value   = r.carbs;
    document.getElementById('setFatGoal').value     = r.fat;
    document.getElementById('setFiberGoal').value   = r.fiber;
    document.getElementById('setWaterGoal').value   = r.waterCups;

    // Save height, weight, goal, then macros
    const wizFt      = parseFloat(document.getElementById('wizardFt').value) || 0;
    const wizIn      = parseFloat(document.getElementById('wizardIn').value) || 0;
    const wizWeightLb = parseFloat(document.getElementById('wizardWeight').value);
    const wizPayload = { goal: wizardGoal };
    if (wizFt || wizIn) wizPayload.height = ftInToCm(wizFt, wizIn);
    if (wizWeightLb > 0) wizPayload.weight = wizWeightLb * KG_PER_LB;
    await fetch(`${API_URL}/user/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + btoa(':' + authPassword) },
        body: JSON.stringify(wizPayload)
    });
    await saveMacroGoals();
    closeMacroWizard();
}

// ─── Meal Builder (create / edit saved meals manually) ────────────────────────

let mealBuilderEditId = null; // null = create, number = edit

function openMealBuilder(mealId = null) {
    mealBuilderEditId = mealId;
    document.getElementById('mealBuilderTitle').textContent =
        mealId ? 'Edit Saved Meal' : 'Create Saved Meal';
    document.getElementById('mbItemsBody').innerHTML = '';

    if (mealId) {
        const meal = (window.savedMealsData || []).find(m => m.id === mealId);
        if (!meal) return;
        document.getElementById('mbMealName').value = meal.name;
        document.getElementById('mbMealType').value = meal.meal_type || 'snack';
        (meal.items || []).forEach(item => addMealBuilderRow(item));
    } else {
        document.getElementById('mbMealName').value = '';
        document.getElementById('mbMealType').value = 'snack';
        addMealBuilderRow(); // start with one empty row
    }

    updateMealBuilderTotals();
    document.getElementById('mealBuilderModal').style.display = 'flex';
    setTimeout(() => document.getElementById('mbMealName').focus(), 50);
}

function closeMealBuilder() {
    document.getElementById('mealBuilderModal').style.display = 'none';
    mealBuilderEditId = null;
}

function closeMealBuilderOutside(event) {
    if (event.target === document.getElementById('mealBuilderModal')) closeMealBuilder();
}

function addMealBuilderRow(item = null) {
    const tbody = document.getElementById('mbItemsBody');
    const tr = document.createElement('tr');
    tr.className = 'mb-item-row';
    tr.innerHTML = `
        <td><input class="mb-input mb-food" type="text"   value="${item ? item.food_item : ''}" placeholder="e.g. Whey Protein"></td>
        <td><input class="mb-input mb-qty"  type="number" value="${item ? item.quantity  : ''}" placeholder="1" step="0.5" min="0" oninput="updateMealBuilderTotals()"></td>
        <td><input class="mb-input mb-unit" type="text"   value="${item ? (item.unit||'') : ''}" placeholder="scoop"></td>
        <td><input class="mb-input mb-num"  type="number" value="${item ? Math.round(item.calories) : ''}" placeholder="0" min="0" oninput="updateMealBuilderTotals()"></td>
        <td><input class="mb-input mb-num"  type="number" value="${item ? Math.round(item.protein)  : ''}" placeholder="0" min="0" oninput="updateMealBuilderTotals()"></td>
        <td><input class="mb-input mb-num"  type="number" value="${item ? Math.round(item.carbs)    : ''}" placeholder="0" min="0" oninput="updateMealBuilderTotals()"></td>
        <td><input class="mb-input mb-num"  type="number" value="${item ? Math.round(item.fat)      : ''}" placeholder="0" min="0" oninput="updateMealBuilderTotals()"></td>
        <td><input class="mb-input mb-num"  type="number" value="${item ? Math.round(item.fiber)    : ''}" placeholder="0" min="0" oninput="updateMealBuilderTotals()"></td>
        <td><button class="delete-btn mb-remove-btn" onclick="this.closest('tr').remove(); updateMealBuilderTotals()">✕</button></td>
    `;
    tbody.appendChild(tr);
    updateMealBuilderTotals();
}

function updateMealBuilderTotals() {
    let cal = 0, pro = 0, carb = 0, fat = 0, fib = 0;
    document.querySelectorAll('#mbItemsBody .mb-item-row').forEach(row => {
        const nums = row.querySelectorAll('.mb-num');
        cal  += parseFloat(nums[0].value) || 0;
        pro  += parseFloat(nums[1].value) || 0;
        carb += parseFloat(nums[2].value) || 0;
        fat  += parseFloat(nums[3].value) || 0;
        fib  += parseFloat(nums[4].value) || 0;
    });
    document.getElementById('mbTotalCal').textContent     = Math.round(cal);
    document.getElementById('mbTotalProtein').textContent = Math.round(pro)  + 'g';
    document.getElementById('mbTotalCarbs').textContent   = Math.round(carb) + 'g';
    document.getElementById('mbTotalFat').textContent     = Math.round(fat)  + 'g';
    document.getElementById('mbTotalFiber').textContent   = Math.round(fib)  + 'g';
}

async function saveMealBuilder() {
    const name = document.getElementById('mbMealName').value.trim();
    if (!name) { document.getElementById('mbMealName').focus(); return; }

    const meal_type = document.getElementById('mbMealType').value;
    const items = [];
    let valid = true;

    document.querySelectorAll('#mbItemsBody .mb-item-row').forEach(row => {
        const food = row.querySelector('.mb-food').value.trim();
        const qty  = parseFloat(row.querySelector('.mb-qty').value) || 1;
        const unit = row.querySelector('.mb-unit').value.trim();
        const nums = row.querySelectorAll('.mb-num');
        const cal  = parseFloat(nums[0].value) || 0;
        const pro  = parseFloat(nums[1].value) || 0;
        const carb = parseFloat(nums[2].value) || 0;
        const fat  = parseFloat(nums[3].value) || 0;
        const fib  = parseFloat(nums[4].value) || 0;
        if (!food) { valid = false; return; }
        items.push({ food_item: food, quantity: qty, unit, calories: cal,
                     protein: pro, carbs: carb, fat, fiber: fib });
    });

    if (!valid || items.length === 0) {
        alert('Please fill in a food name for each item.');
        return;
    }

    const body = JSON.stringify({ name, meal_type, items });
    const url  = mealBuilderEditId
        ? `${API_URL}/meals/${mealBuilderEditId}`
        : `${API_URL}/meals/create`;
    const method = mealBuilderEditId ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + btoa(':' + authPassword) },
            body
        });
        if (res.ok) {
            closeMealBuilder();
            loadSavedMeals();
        } else {
            alert('Failed to save meal.');
        }
    } catch { alert('Error saving meal.'); }
}

async function deleteSavedMeal(mealId, mealName) {
    // Reuse the load meal modal as a generic confirm
    pendingDeleteMealId = mealId;
    document.getElementById('loadMealConfirmText').textContent =
        `Delete "${mealName}"? This cannot be undone.`;
    document.getElementById('loadMealModal').querySelector('.primary-btn').textContent = 'Delete';
    document.getElementById('loadMealModal').querySelector('.primary-btn').onclick = confirmDeleteMeal;
    document.getElementById('loadMealModal').style.display = 'flex';
}

let pendingDeleteMealId = null;

async function confirmDeleteMeal() {
    if (!pendingDeleteMealId) return;
    const id = pendingDeleteMealId;
    // Reset modal back to load behaviour
    document.getElementById('loadMealModal').style.display = 'none';
    document.getElementById('loadMealModal').querySelector('.primary-btn').textContent = 'Load Meal';
    document.getElementById('loadMealModal').querySelector('.primary-btn').onclick = confirmLoadMeal;
    pendingDeleteMealId = null;
    pendingLoadMealId = null;

    try {
        const res = await fetch(`${API_URL}/meals/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': 'Basic ' + btoa(':' + authPassword) }
        });
        if (res.ok) loadSavedMeals();
    } catch { alert('Failed to delete meal.'); }
}

// ─── History / Calendar ────────────────────────────────────────────────────────

let historyMonth = null;          // { year, month } (month 0-indexed)
let historyRangeData = null;      // array of day objects for current month
let historySelectedDate = null;   // "YYYY-MM-DD"
let historyChartDays = 7;

// Grading thresholds (persisted in localStorage)
const _defaultMacros = () => ({
    calories: { enabled: true, direction: 'within' },
    protein:  { enabled: true, direction: 'within' },
    carbs:    { enabled: true, direction: 'within' },
    fat:      { enabled: true, direction: 'within' }
});
let calGradeThresholds = (function() {
    try {
        const stored = localStorage.getItem('calGradeThresholds');
        if (stored) {
            const parsed = JSON.parse(stored);
            if (!parsed.macros) parsed.macros = _defaultMacros();
            return parsed;
        }
    } catch(e) {}
    return { success: 10, close: 15, macros: _defaultMacros() };
})();

function macroPasses(val, goal, direction, threshold) {
    if (!goal) return true;
    if (direction === 'under') return val <= goal;
    if (direction === 'over')  return val >= goal;
    return Math.abs(val / goal - 1) <= threshold;
}

function loadHistoryPage() {
    if (!historyMonth) {
        const now = new Date();
        historyMonth = { year: now.getFullYear(), month: now.getMonth() };
    }
    updateGradingLegend();
    fetchAndRenderCalendar();
    loadHistoryCharts(historyChartDays);
}

async function fetchAndRenderCalendar() {
    const { year, month } = historyMonth;
    const monthStart = new Date(year, month, 1);
    const monthEnd   = new Date(year, month + 1, 0);

    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const tzOffset = new Date().getTimezoneOffset();

    document.getElementById('historyMonthLabel').textContent =
        monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    try {
        const res = await fetch(
            `${API_URL}/food/history/range?start=${fmt(monthStart)}&end=${fmt(monthEnd)}&tz_offset=${tzOffset}`,
            { headers: { 'Authorization': 'Basic ' + btoa(':' + authPassword) } }
        );
        const data = await res.json();
        historyRangeData = data.days;
        renderCalendar(historyRangeData);
    } catch (e) {
        console.error('Failed to load history range', e);
    }
}

function renderCalendar(days) {
    const grid = document.getElementById('historyCalGrid');
    grid.innerHTML = '';

    const { year, month } = historyMonth;
    const goals = userSettings || {};
    const todayStr = (() => {
        const t = new Date();
        return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
    })();

    // Build lookup
    const dayMap = {};
    for (const d of days) dayMap[d.date] = d;

    // First day of month; adjust so Mon=0
    const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Leading blanks
    for (let i = 0; i < firstDow; i++) {
        const blank = document.createElement('div');
        blank.className = 'cal-day cal-day--blank';
        grid.appendChild(blank);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const dayData = dayMap[dateStr];
        const isFuture = dateStr > todayStr;
        const isToday  = dateStr === todayStr;

        const cell = document.createElement('div');
        cell.className = 'cal-day';
        if (isFuture) {
            cell.classList.add('cal-day--future');
        } else if (!dayData || dayData.calories === null) {
            cell.classList.add('cal-day--empty');
        } else {
            cell.classList.add(calDayColor(dayData, goals));
            cell.addEventListener('click', () => selectHistoryDay(dateStr));
        }
        if (isToday)  cell.classList.add('cal-day--today');
        if (dateStr === historySelectedDate) cell.classList.add('cal-day--selected');

        const num = document.createElement('span');
        num.className = 'cal-day-num';
        num.textContent = d;
        cell.appendChild(num);

        if (dayData && dayData.calories !== null && !isFuture) {
            const cal = document.createElement('span');
            cal.className = 'cal-day-cal';
            cal.textContent = Math.round(dayData.calories);
            cell.appendChild(cal);
        }

        grid.appendChild(cell);
    }
}

function calDayColor(day, goals) {
    if (!goals.calorie_goal) return 'cal-day--yellow';
    const s = calGradeThresholds.success / 100;
    const c = calGradeThresholds.close   / 100;
    const m = calGradeThresholds.macros || _defaultMacros();
    const calOk  = !m.calories.enabled || macroPasses(day.calories, goals.calorie_goal, m.calories.direction, s);
    const proOk  = !m.protein.enabled  || macroPasses(day.protein,  goals.protein_goal, m.protein.direction,  s);
    const carbOk = !m.carbs.enabled    || macroPasses(day.carbs,    goals.carbs_goal,   m.carbs.direction,    s);
    const fatOk  = !m.fat.enabled      || macroPasses(day.fat,      goals.fat_goal,     m.fat.direction,      s);
    const calClose = macroPasses(day.calories, goals.calorie_goal, m.calories.direction, c);
    if (calOk && proOk && carbOk && fatOk) return 'cal-day--green';
    if (calClose) return 'cal-day--yellow';
    return 'cal-day--red';
}

function updateGradingLegend() {
    const s = calGradeThresholds.success;
    const c = calGradeThresholds.close;
    const gl = document.getElementById('legendGreenLabel');
    const yl = document.getElementById('legendYellowLabel');
    const rl = document.getElementById('legendRedLabel');
    if (gl) gl.textContent = `Goals met`;
    if (yl) yl.textContent = `Close (cal ±${s+1}–${c}%)`;
    if (rl) rl.textContent = `Off track (>${c}%)`;
}

function openGradingModal() {
    document.getElementById('gradeSuccessInput').value = calGradeThresholds.success;
    document.getElementById('gradeCloseInput').value   = calGradeThresholds.close;
    const m = calGradeThresholds.macros || _defaultMacros();
    ['calories', 'protein', 'carbs', 'fat'].forEach(key => {
        const cfg = m[key] || { enabled: true, direction: 'within' };
        document.getElementById(`gradeEn_${key}`).checked = cfg.enabled;
        document.getElementById(`gradeDir_${key}`).value  = cfg.direction;
    });
    document.getElementById('gradingModal').style.display = 'flex';
}

function closeGradingModal() {
    document.getElementById('gradingModal').style.display = 'none';
}

function closeGradingModalOutside(e) {
    if (e.target === document.getElementById('gradingModal')) closeGradingModal();
}

function saveGradingThresholds() {
    const s = parseInt(document.getElementById('gradeSuccessInput').value, 10);
    const c = parseInt(document.getElementById('gradeCloseInput').value,   10);
    if (isNaN(s) || isNaN(c) || s < 1 || c < 1) return;
    if (s >= c) {
        document.getElementById('gradeCloseInput').style.borderColor = '#e57373';
        document.getElementById('gradeSuccessInput').style.borderColor = '#e57373';
        return;
    }
    document.getElementById('gradeCloseInput').style.borderColor = '';
    document.getElementById('gradeSuccessInput').style.borderColor = '';
    const macros = {};
    ['calories', 'protein', 'carbs', 'fat'].forEach(key => {
        macros[key] = {
            enabled:   document.getElementById(`gradeEn_${key}`).checked,
            direction: document.getElementById(`gradeDir_${key}`).value
        };
    });
    calGradeThresholds = { success: s, close: c, macros };
    localStorage.setItem('calGradeThresholds', JSON.stringify(calGradeThresholds));
    updateGradingLegend();
    closeGradingModal();
    if (historyRangeData) renderCalendar(historyRangeData);
}

function shiftHistoryMonth(delta) {
    let { year, month } = historyMonth;
    month += delta;
    if (month > 11) { month = 0; year++; }
    if (month < 0)  { month = 11; year--; }
    historyMonth = { year, month };
    historySelectedDate = null;
    document.getElementById('historyDayPanel').style.display = 'none';
    fetchAndRenderCalendar();
}

async function selectHistoryDay(dateStr) {
    historySelectedDate = dateStr;
    // Re-render calendar to update selected highlight
    if (historyRangeData) renderCalendar(historyRangeData);

    const tzOffset = new Date().getTimezoneOffset();
    try {
        const res = await fetch(
            `${API_URL}/food/date?date=${dateStr}&tz_offset=${tzOffset}`,
            { headers: { 'Authorization': 'Basic ' + btoa(':' + authPassword) } }
        );
        const data = await res.json();
        renderHistoryDayPanel(dateStr, data);
    } catch (e) {
        console.error('Failed to load day', e);
    }
}

function renderHistoryDayPanel(dateStr, data) {
    const panel = document.getElementById('historyDayPanel');
    panel.style.display = 'block';

    // Format date as MM/DD/YY
    const [y, m, d] = dateStr.split('-');
    const displayDate = `${m}/${d}/${y.slice(2)}`;
    const dow = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
    document.getElementById('historyDayTitle').textContent = `${dow}, ${displayDate}`;

    const cups = (data.water_ml / 240).toFixed(1);
    document.getElementById('historyDayWater').textContent = `Water: ${cups} cups`;

    const t = data.totals;
    const goals = userSettings;

    // Grade badge in header is unused (grade shown in table instead)
    const gradeBadge = document.getElementById('historyDayGrade');
    if (gradeBadge) gradeBadge.style.display = 'none';

    // Return CSS class for a total value vs its goal, respecting per-macro direction
    function cellCls(val, goal, macroKey) {
        if (!goal) return '';
        const s = calGradeThresholds.success / 100;
        const c = calGradeThresholds.close / 100;
        const m = calGradeThresholds.macros || _defaultMacros();
        const dir = (macroKey && m[macroKey]) ? m[macroKey].direction : 'within';
        if (macroPasses(val, goal, dir, s)) return ' class="hist-val-green"';
        if (macroPasses(val, goal, dir, c)) return ' class="hist-val-yellow"';
        return ' class="hist-val-red"';
    }

    let html = '';
    if (data.entries.length === 0) {
        html = '<p class="history-no-entries">No entries logged this day.</p>';
    } else {
        const cg = goals?.calorie_goal, pg = goals?.protein_goal, carbg = goals?.carbs_goal, fatg = goals?.fat_goal;
        html = `<table class="history-entries-table">
            <thead><tr><th>Food</th><th>Cal</th><th>P</th><th>C</th><th>F</th></tr></thead>
            <tbody>`;
        for (const e of data.entries) {
            html += `<tr>
                <td>${e.food_item}</td>
                <td>${Math.round(e.calories)}</td>
                <td>${Math.round(e.protein)}g</td>
                <td>${Math.round(e.carbs)}g</td>
                <td>${Math.round(e.fat)}g</td>
            </tr>`;
        }
        const gradeColor = calDayColor(t, goals);
        const gradeText  = gradeColor === 'cal-day--green' ? '✓ Success'
                         : gradeColor === 'cal-day--yellow' ? '~ Needs Work'
                         : '✗ Failure';
        const gradeCls   = gradeColor === 'cal-day--green' ? 'grade-success'
                         : gradeColor === 'cal-day--yellow' ? 'grade-close'
                         : 'grade-fail';
        html += `</tbody><tfoot>
            <tr class="history-totals-row">
                <td>Total</td>
                <td${cellCls(t.calories, cg, 'calories')}>${Math.round(t.calories)}</td>
                <td${cellCls(t.protein, pg, 'protein')}>${Math.round(t.protein)}g</td>
                <td${cellCls(t.carbs, carbg, 'carbs')}>${Math.round(t.carbs)}g</td>
                <td${cellCls(t.fat, fatg, 'fat')}>${Math.round(t.fat)}g</td>
            </tr>
            <tr class="history-goals-row">
                <td>Goal</td>
                <td>${cg ? Math.round(cg) : '—'}</td>
                <td>${pg ? Math.round(pg) + 'g' : '—'}</td>
                <td>${carbg ? Math.round(carbg) + 'g' : '—'}</td>
                <td>${fatg ? Math.round(fatg) + 'g' : '—'}</td>
            </tr>
            <tr class="history-grade-row">
                <td colspan="5"><span class="history-day-grade ${gradeCls}">${gradeText}</span></td>
            </tr>
        </tfoot></table>`;
    }
    document.getElementById('historyDayContent').innerHTML = html;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function exportCSV() {
    const tzOffset = new Date().getTimezoneOffset();
    const url = `${API_URL}/food/export/csv?tz_offset=${tzOffset}`;
    const res = await fetch(url, { headers: { 'Authorization': 'Basic ' + btoa(':' + authPassword) } });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dockjock_food_log.csv';
    a.click();
    URL.revokeObjectURL(a.href);
}

// ─── Charts ────────────────────────────────────────────────────────────────────

function toggleChart(btn) {
    const blockId = btn.dataset.chart + 'Block';
    const block = document.getElementById(blockId);
    if (!block) return;
    const isActive = btn.classList.toggle('active');
    block.style.display = isActive ? '' : 'none';
}

async function loadHistoryCharts(days) {
    historyChartDays = days;
    ['chart7btn','chart30btn','chart90btn'].forEach(id => {
        document.getElementById(id).classList.remove('active');
    });
    document.getElementById(`chart${days}btn`).classList.add('active');

    const tzOffset = new Date().getTimezoneOffset();
    const end   = new Date();
    const start = new Date(); start.setDate(end.getDate() - (days - 1));
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    try {
        const res = await fetch(
            `${API_URL}/food/history/range?start=${fmt(start)}&end=${fmt(end)}&tz_offset=${tzOffset}`,
            { headers: { 'Authorization': 'Basic ' + btoa(':' + authPassword) } }
        );
        const data = await res.json();
        const dayList = data.days;

        const labels  = dayList.map(d => { const [,m,day] = d.date.split('-'); return `${m}/${day}`; });
        const cals    = dayList.map(d => d.calories ?? 0);
        const protein = dayList.map(d => d.protein  ?? 0);
        const carbs   = dayList.map(d => d.carbs    ?? 0);
        const fat     = dayList.map(d => d.fat      ?? 0);
        const fiber   = dayList.map(d => d.fiber    ?? 0);
        const water   = dayList.map(d => (d.water_ml ?? 0) / 240);

        const goals = userSettings || {};
        drawLineChart('chartCalories', labels, [{ values: cals,    color: '#e57373' }], goals.calorie_goal);
        drawLineChart('chartProtein',  labels, [{ values: protein, color: '#87c5f5' }], goals.protein_goal);
        drawLineChart('chartFat',      labels, [{ values: fat,     color: '#ffb347' }], goals.fat_goal);
        drawLineChart('chartCarbs',    labels, [{ values: carbs,   color: '#81d4c0' }], goals.carbs_goal);
        drawLineChart('chartFiber',    labels, [{ values: fiber,   color: '#b39ddb' }], goals.fiber_goal);
        drawLineChart('chartWater',    labels, [{ values: water,   color: '#4facfe' }], goals.water_goal ? goals.water_goal / 240 : null);

        // Weight chart — separate endpoint
        const wRes = await fetch(
            `${API_URL}/weight/history?start=${fmt(start)}&end=${fmt(end)}&tz_offset=${tzOffset}`,
            { headers: { 'Authorization': 'Basic ' + btoa(':' + authPassword) } }
        );
        const wData = await wRes.json();
        // Map weight entries into same label array (null for days with no entry)
        const weightMap = {};
        for (const e of wData.entries) weightMap[e.date] = e.weight_lbs;
        const weightVals = dayList.map(d => weightMap[d.date] ?? null);
        drawLineChart('chartWeight', labels, [{ values: weightVals.map(v => v ?? 0), color: '#9575cd' }], null, true);

    } catch (e) {
        console.error('Failed to load chart data', e);
    }
}

function drawLineChart(canvasId, labels, datasets, goalValue, skipZero = false) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth || canvas.parentElement.offsetWidth || 600;
    const H = canvas.height;
    canvas.width = W;

    const PAD = { top: 16, right: 16, bottom: 32, left: 44 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top  - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    const allVals = datasets.flatMap(ds => ds.values).concat(goalValue ? [goalValue] : []);
    const maxVal  = Math.max(...allVals, 1);
    const step    = labels.length > 1 ? cW / (labels.length - 1) : cW;

    const toX = i => PAD.left + i * step;
    const toY = v => PAD.top + cH - (v / maxVal) * cH;

    // Grid lines
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = PAD.top + (cH / 4) * i;
        ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
        ctx.fillStyle = '#bbb';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(maxVal * (1 - i / 4)), PAD.left - 6, y + 4);
    }

    // Goal line
    if (goalValue) {
        const gy = toY(goalValue);
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = '#bbb';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(PAD.left, gy); ctx.lineTo(PAD.left + cW, gy); ctx.stroke();
        ctx.restore();
    }

    // Dataset lines
    for (const ds of datasets) {
        if (skipZero) {
            // Draw line segments only between non-zero points
            let moved = false;
            ds.values.forEach((v, i) => {
                if (!v) { moved = false; return; }
                if (!moved) { ctx.beginPath(); ctx.moveTo(toX(i), toY(v)); moved = true; }
                else ctx.lineTo(toX(i), toY(v));
            });
        } else {
            ctx.beginPath();
            ds.values.forEach((v, i) => {
                i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v));
            });
        }
        ctx.strokeStyle = ds.color;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Dots
        ds.values.forEach((v, i) => {
            if (!v) return;
            ctx.beginPath();
            ctx.arc(toX(i), toY(v), 3.5, 0, 2 * Math.PI);
            ctx.fillStyle = ds.color;
            ctx.fill();
        });
    }

    // X labels (show every nth to avoid crowding)
    const nth = Math.ceil(labels.length / 12);
    ctx.fillStyle = '#aaa';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    labels.forEach((lbl, i) => {
        if (i % nth === 0 || i === labels.length - 1) {
            ctx.fillText(lbl, toX(i), H - 8);
        }
    });
}

function drawStackedBarChart(canvasId, labels, datasets) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth || canvas.parentElement.offsetWidth || 600;
    const H = canvas.height;
    canvas.width = W;

    const PAD = { top: 16, right: 16, bottom: 32, left: 44 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top  - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    const n = labels.length;
    const barW  = Math.max(4, (cW / n) * 0.6);
    const gap   = cW / n;

    // Max stacked value
    let maxVal = 1;
    for (let i = 0; i < n; i++) {
        const total = datasets.reduce((s, ds) => s + (ds.values[i] ?? 0), 0);
        if (total > maxVal) maxVal = total;
    }

    const toY = v => PAD.top + cH - (v / maxVal) * cH;

    // Grid lines
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = PAD.top + (cH / 4) * i;
        ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
        ctx.fillStyle = '#bbb';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(maxVal * (1 - i / 4)), PAD.left - 6, y + 4);
    }

    // Bars
    for (let i = 0; i < n; i++) {
        const x = PAD.left + i * gap + gap / 2 - barW / 2;
        let base = PAD.top + cH;
        for (const ds of datasets) {
            const v = ds.values[i] ?? 0;
            if (v <= 0) continue;
            const bH = (v / maxVal) * cH;
            ctx.fillStyle = ds.color;
            ctx.fillRect(x, base - bH, barW, bH);
            base -= bH;
        }
    }

    // X labels
    const nth = Math.ceil(n / 12);
    ctx.fillStyle = '#aaa';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    labels.forEach((lbl, i) => {
        if (i % nth === 0 || i === n - 1) {
            ctx.fillText(lbl, PAD.left + i * gap + gap / 2, H - 8);
        }
    });
}

// ─── Weigh-In Reminder ────────────────────────────────────────────────────────

async function checkWeighInReminder() {
    if (!userSettings) return;
    // JS getDay(): 0=Sun,1=Mon,...6=Sat. weigh_in_day: 0=Mon,...6=Sun
    const jsDay = new Date().getDay();
    const localDay = jsDay === 0 ? 6 : jsDay - 1; // convert to Mon=0
    if (localDay !== (userSettings.weigh_in_day ?? 0)) return;

    // Check if weight already logged today
    const tzOffset = new Date().getTimezoneOffset();
    try {
        const res = await fetch(`${API_URL}/weight/today?tz_offset=${tzOffset}`, {
            headers: { 'Authorization': 'Basic ' + btoa(':' + authPassword) }
        });
        const data = await res.json();
        if (!data.logged_today) {
            document.getElementById('weighInModal').style.display = 'flex';
            // Also fire browser notification if enabled
            const prefs = JSON.parse(localStorage.getItem('notifPrefs') || '{}');
            if (prefs.weighIn && Notification.permission === 'granted') {
                new Notification('DockJock', { body: 'Time to log your weight!' });
            }
        }
    } catch (e) {
        console.error('Weight reminder check failed', e);
    }
}

function closeWeighInModal() {
    document.getElementById('weighInModal').style.display = 'none';
    document.getElementById('weighInInput').value = '';
}

async function submitWeighIn() {
    const val = parseFloat(document.getElementById('weighInInput').value);
    if (!val || val < 50 || val > 700) return;
    const tzOffset = new Date().getTimezoneOffset();
    try {
        await fetch(`${API_URL}/weight/log?tz_offset=${tzOffset}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + btoa(':' + authPassword) },
            body: JSON.stringify({ weight_lbs: val })
        });
        closeWeighInModal();
        await loadUserSettings();  // refresh profile weight display
    } catch (e) {
        console.error('Weight log failed', e);
    }
}

// ─── Midnight Auto-Reset ──────────────────────────────────────────────────────

let _midnightWatcherStarted = false;
let _lastLoadedDate = null;

function startMidnightWatcher() {
    if (_midnightWatcherStarted) return;
    _midnightWatcherStarted = true;
    _lastLoadedDate = new Date().toLocaleDateString('en-CA');
    setInterval(() => {
        const today = new Date().toLocaleDateString('en-CA');
        if (today !== _lastLoadedDate) {
            _lastLoadedDate = today;
            loadTodayData();
            drawProgressRings();
        }
    }, 60_000);
}

// ─── Notifications ────────────────────────────────────────────────────────────

let _notifWatcherStarted = false;
let _lastNotifDate = null;

function startNotifWatcher() {
    if (_notifWatcherStarted) return;
    _notifWatcherStarted = true;
    setInterval(() => {
        const prefs = JSON.parse(localStorage.getItem('notifPrefs') || '{}');
        if (!prefs.dailySummary || Notification.permission !== 'granted') return;
        const now = new Date();
        const [h, m] = (prefs.summaryTime || '20:00').split(':').map(Number);
        const today = now.toLocaleDateString('en-CA');
        if (now.getHours() === h && now.getMinutes() === m && _lastNotifDate !== today) {
            _lastNotifDate = today;
            new Notification('DockJock', { body: "Time to review today's nutrition!" });
        }
    }, 60_000);
}

function requestNotifPermission() {
    if (!('Notification' in window)) return;
    Notification.requestPermission().then(() => updateNotifPermStatus());
}

function updateNotifPermStatus() {
    if (!('Notification' in window)) {
        const s = document.getElementById('notifPermStatus');
        if (s) s.textContent = 'Not supported in this browser';
        return;
    }
    const btn = document.getElementById('notifPermBtn');
    const status = document.getElementById('notifPermStatus');
    const p = Notification.permission;
    if (p === 'granted') {
        if (btn) btn.style.display = 'none';
        if (status) { status.textContent = '✓ Enabled'; status.style.color = '#81c784'; }
    } else if (p === 'denied') {
        if (btn) btn.style.display = 'none';
        if (status) { status.textContent = 'Blocked — allow in browser settings'; status.style.color = '#e57373'; }
    } else {
        if (btn) btn.style.display = '';
        if (status) status.textContent = '';
    }
}

function saveNotifPrefs() {
    const prefs = {
        weighIn: document.getElementById('notifWeighIn').checked,
        dailySummary: document.getElementById('notifDailySummary').checked,
        summaryTime: document.getElementById('notifSummaryTime').value || '20:00'
    };
    localStorage.setItem('notifPrefs', JSON.stringify(prefs));
    showSettingsStatus('notifStatus', '✓ Saved');
}

function loadNotifPrefs() {
    const prefs = JSON.parse(localStorage.getItem('notifPrefs') || '{}');
    const wi = document.getElementById('notifWeighIn');
    const ds = document.getElementById('notifDailySummary');
    const st = document.getElementById('notifSummaryTime');
    if (wi) wi.checked = prefs.weighIn || false;
    if (ds) ds.checked = prefs.dailySummary || false;
    if (st) st.value = prefs.summaryTime || '20:00';
    updateNotifPermStatus();
}
