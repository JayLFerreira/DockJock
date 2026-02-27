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

function displaySavedMeals(meals) {
    const mealsList = document.getElementById('savedMealsList');

    if (meals.length === 0) {
        mealsList.innerHTML = '<p style="color: #999;">No saved meals yet. Save your favorite meals for quick access!</p>';
        return;
    }

    mealsList.innerHTML = meals.map(meal => `
        <div class="saved-meal-card" onclick="openLoadMealModal(${meal.id}, '${meal.name.replace(/'/g, "\\'")}')">
            <div class="saved-meal-name">${meal.name}</div>
            <div class="saved-meal-info">
                ${meal.meal_type} • ${Math.round(meal.calories)} cal<br>
                P: ${Math.round(meal.protein)}g | C: ${Math.round(meal.carbs)}g | F: ${Math.round(meal.fat)}g
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
