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
    document.getElementById('addManualBtn').addEventListener('click', () => alert('Manual entry feature coming soon!'));
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
        });
    });

    // Update current date
    updateCurrentDate();
}

function showLoginPage() {
    document.getElementById('loginPage').classList.add('active');
    document.getElementById('mainApp').classList.remove('active');
}

function showMainApp() {
    document.getElementById('loginPage').classList.remove('active');
    document.getElementById('mainApp').classList.add('active');
    loadTrackedMetrics();
    loadUserSettings();
    loadTodayData();
    loadSavedMeals();
    drawProgressRings();
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
function drawProgressRing(canvasId, current, goal, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = 60;
    const lineWidth = 12;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate percentage
    const percentage = Math.min((current / goal) * 100, 150); // Allow up to 150% to show over-consumption
    const angle = Math.min((percentage / 100) * 2 * Math.PI, 2 * Math.PI);

    // Determine color based on percentage
    let ringColor = color;
    if (percentage > 100) {
        ringColor = '#ff4444'; // Red if over goal
    } else if (percentage > 90) {
        ringColor = '#ffa500'; // Orange when close
    }

    // Background circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    // Progress circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + angle);
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Percentage text inside ring
    const pct = Math.round((current / goal) * 100);
    ctx.fillStyle = percentage > 100 ? '#ff4444' : '#333';
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${pct}%`, centerX, centerY);
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

    drawProgressRing('calorieRing', current.calories, goals.calorie_goal, '#667eea');
    drawProgressRing('proteinRing', current.protein, goals.protein_goal, '#f093fb');
    drawProgressRing('carbsRing', current.carbs, goals.carbs_goal, '#4facfe');
    drawProgressRing('fatRing', current.fat, goals.fat_goal, '#43e97b');
    drawProgressRing('fiberRing', current.fiber, goals.fiber_goal, '#fa709a');
    // Water ring uses cups
    drawProgressRing('waterRing', current.water / ML_PER_CUP, goals.water_goal / ML_PER_CUP, '#30cfd0');
}

async function loadTodayData() {
    try {
        // Load food entries
        const foodResponse = await fetch(`${API_URL}/food/today`, {
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
        const waterResponse = await fetch(`${API_URL}/water/today`, {
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

    // Show loading
    statusEl.textContent = 'Parsing food items...';
    statusEl.className = 'status-message loading';
    addBtn.disabled = true;

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
        addBtn.disabled = false;
    }
}

async function deleteEntry(entryId) {
    if (!confirm('Delete this entry?')) return;
    
    try {
        const response = await fetch(`${API_URL}/food/${entryId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': 'Basic ' + btoa(':' + authPassword)
            }
        });

        if (response.ok) {
            await loadTodayData();
        }
    } catch (error) {
        console.error('Error deleting entry:', error);
        alert('Failed to delete entry');
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
            const waterResponse = await fetch(`${API_URL}/water/today`, {
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
    const payload = {
        height: ftInToCm(ft, inches),
        weight: weightLb * KG_PER_LB,
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

    // Save macros + goal together
    await fetch(`${API_URL}/user/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + btoa(':' + authPassword) },
        body: JSON.stringify({ goal: wizardGoal })
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
