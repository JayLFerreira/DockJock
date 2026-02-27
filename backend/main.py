from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from sqlalchemy.orm import Session
from passlib.hash import bcrypt
from pydantic import BaseModel
from typing import Optional
import os
import json

from database import init_db, get_db, User, FoodEntry, CachedFood, WaterEntry, SavedMeal
from openai_service import parse_food_items

app = FastAPI(title="DockJock API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBasic()

# Initialize database on startup
@app.on_event("startup")
async def startup_event():
    init_db()

# Pydantic models
class LoginRequest(BaseModel):
    password: str

class LoginResponse(BaseModel):
    success: bool
    message: str

class UserSettings(BaseModel):
    height: Optional[float] = None
    weight: Optional[float] = None
    calorie_goal: Optional[float] = None
    protein_goal: Optional[float] = None
    carbs_goal: Optional[float] = None
    fat_goal: Optional[float] = None
    fiber_goal: Optional[float] = None
    water_goal: Optional[float] = None
    openai_model: Optional[str] = None

class AddFoodRequest(BaseModel):
    food_text: str
    meal_type: str

class ManualFoodEntry(BaseModel):
    food_name: str
    quantity: float
    unit: str
    meal_type: str
    calories: float
    protein: float
    carbs: float
    fat: float
    fiber: float
    sugar: Optional[float] = 0
    saturated_fat: Optional[float] = 0
    micros: Optional[dict] = None

class SaveMealRequest(BaseModel):
    name: str
    meal_type: str
    entry_ids: list[int]

class AddWaterRequest(BaseModel):
    amount: float  # in ml

# Authentication dependency
def verify_password(credentials: HTTPBasicCredentials = Depends(security), db: Session = Depends(get_db)):
    user = db.query(User).first()
    if not user or not bcrypt.verify(credentials.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password",
            headers={"WWW-Authenticate": "Basic"},
        )
    return user

# Routes
@app.get("/")
async def root():
    return {"message": "DockJock API", "status": "running"}

@app.post("/api/login", response_model=LoginResponse)
async def login(request: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).first()
    if user and bcrypt.verify(request.password, user.password_hash):
        return LoginResponse(success=True, message="Login successful")
    return LoginResponse(success=False, message="Invalid password")

@app.get("/api/user/settings")
async def get_settings(user: User = Depends(verify_password)):
    return {
        "height": user.height,
        "weight": user.weight,
        "calorie_goal": user.calorie_goal,
        "protein_goal": user.protein_goal,
        "carbs_goal": user.carbs_goal,
        "fat_goal": user.fat_goal,
        "fiber_goal": user.fiber_goal,
        "water_goal": user.water_goal,
        "openai_model": user.openai_model
    }

@app.put("/api/user/settings")
async def update_settings(
    settings: UserSettings,
    user: User = Depends(verify_password),
    db: Session = Depends(get_db)
):
    if settings.height is not None:
        user.height = settings.height
    if settings.weight is not None:
        user.weight = settings.weight
    if settings.calorie_goal is not None:
        user.calorie_goal = settings.calorie_goal
    if settings.protein_goal is not None:
        user.protein_goal = settings.protein_goal
    if settings.carbs_goal is not None:
        user.carbs_goal = settings.carbs_goal
    if settings.fat_goal is not None:
        user.fat_goal = settings.fat_goal
    if settings.fiber_goal is not None:
        user.fiber_goal = settings.fiber_goal
    if settings.water_goal is not None:
        user.water_goal = settings.water_goal
    if settings.openai_model is not None:
        user.openai_model = settings.openai_model
    
    db.commit()
    return {"success": True, "message": "Settings updated"}

@app.post("/api/user/change-password")
async def change_password(
    current_password: str,
    new_password: str,
    user: User = Depends(verify_password),
    db: Session = Depends(get_db)
):
    if not bcrypt.verify(current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    
    user.password_hash = bcrypt.hash(new_password)
    db.commit()
    return {"success": True, "message": "Password changed successfully"}

# Food Entry Endpoints
@app.post("/api/food/add")
async def add_food_entry(
    request: AddFoodRequest,
    user: User = Depends(verify_password),
    db: Session = Depends(get_db)
):
    """Parse food text and add entries"""
    try:
        parsed_items = parse_food_items(request.food_text, db)
        
        entries = []
        for item in parsed_items:
            entry = FoodEntry(
                user_id=user.id,
                meal_type=request.meal_type,
                food_item=item["food_name"],
                quantity=item["quantity"],
                unit=item["unit"],
                calories=item["total_nutrition"]["calories"],
                protein=item["total_nutrition"]["protein"],
                carbs=item["total_nutrition"]["carbs"],
                fat=item["total_nutrition"]["fat"],
                fiber=item["total_nutrition"]["fiber"],
                sugar=item["total_nutrition"].get("sugar", 0),
                saturated_fat=item["total_nutrition"].get("saturated_fat", 0),
                micros_json=json.dumps(item["total_nutrition"].get("micros", {}))
            )
            db.add(entry)
            entries.append(entry)
        
        db.commit()
        
        return {
            "success": True,
            "message": f"Added {len(entries)} food items",
            "entries": [
                {
                    "id": e.id,
                    "food_item": e.food_item,
                    "quantity": e.quantity,
                    "unit": e.unit,
                    "calories": e.calories,
                    "protein": e.protein,
                    "carbs": e.carbs,
                    "fat": e.fat,
                    "fiber": e.fiber
                } for e in entries
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/food/add-manual")
async def add_manual_food_entry(
    entry: ManualFoodEntry,
    user: User = Depends(verify_password),
    db: Session = Depends(get_db)
):
    """Add manual food entry"""
    food_entry = FoodEntry(
        user_id=user.id,
        meal_type=entry.meal_type,
        food_item=entry.food_name,
        quantity=entry.quantity,
        unit=entry.unit,
        calories=entry.calories,
        protein=entry.protein,
        carbs=entry.carbs,
        fat=entry.fat,
        fiber=entry.fiber,
        sugar=entry.sugar or 0,
        saturated_fat=entry.saturated_fat or 0,
        micros_json=json.dumps(entry.micros or {})
    )
    db.add(food_entry)
    
    # Also add to cache
    per_unit_nutrition = {
        "calories": entry.calories / entry.quantity,
        "protein": entry.protein / entry.quantity,
        "carbs": entry.carbs / entry.quantity,
        "fat": entry.fat / entry.quantity,
        "fiber": entry.fiber / entry.quantity,
        "sugar": (entry.sugar or 0) / entry.quantity,
        "saturated_fat": (entry.saturated_fat or 0) / entry.quantity,
        "micros": {}
    }
    
    if entry.micros:
        for key, value in entry.micros.items():
            per_unit_nutrition["micros"][key] = value / entry.quantity
    
    from openai_service import add_to_cache
    add_to_cache(entry.food_name, entry.unit, per_unit_nutrition, db)
    
    db.commit()
    
    return {"success": True, "message": "Manual entry added", "id": food_entry.id}

@app.get("/api/food/today")
async def get_today_entries(
    user: User = Depends(verify_password),
    db: Session = Depends(get_db)
):
    """Get today's food entries"""
    from datetime import datetime, timedelta
    
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    
    entries = db.query(FoodEntry).filter(
        FoodEntry.user_id == user.id,
        FoodEntry.date >= today_start,
        FoodEntry.date < today_end
    ).order_by(FoodEntry.date.desc()).all()
    
    # Calculate totals
    totals = {
        "calories": sum(e.calories for e in entries),
        "protein": sum(e.protein for e in entries),
        "carbs": sum(e.carbs for e in entries),
        "fat": sum(e.fat for e in entries),
        "fiber": sum(e.fiber for e in entries),
        "sugar": sum(e.sugar for e in entries),
        "saturated_fat": sum(e.saturated_fat for e in entries)
    }
    
    return {
        "entries": [
            {
                "id": e.id,
                "meal_type": e.meal_type,
                "source_meal": e.source_meal,
                "food_item": e.food_item,
                "quantity": e.quantity,
                "unit": e.unit,
                "calories": e.calories,
                "protein": e.protein,
                "carbs": e.carbs,
                "fat": e.fat,
                "fiber": e.fiber,
                "time": e.date.isoformat()
            } for e in entries
        ],
        "totals": totals
    }

class EditFoodRequest(BaseModel):
    food_name: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    calories: Optional[float] = None
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fat: Optional[float] = None
    fiber: Optional[float] = None

@app.put("/api/food/{entry_id}")
async def edit_food_entry(
    entry_id: int,
    entry_data: EditFoodRequest,
    user: User = Depends(verify_password),
    db: Session = Depends(get_db)
):
    """Edit a food entry"""
    entry = db.query(FoodEntry).filter(
        FoodEntry.id == entry_id,
        FoodEntry.user_id == user.id
    ).first()

    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    if entry_data.food_name is not None:
        entry.food_item = entry_data.food_name
    if entry_data.quantity is not None:
        entry.quantity = entry_data.quantity
    if entry_data.unit is not None:
        entry.unit = entry_data.unit
    if entry_data.calories is not None:
        entry.calories = entry_data.calories
    if entry_data.protein is not None:
        entry.protein = entry_data.protein
    if entry_data.carbs is not None:
        entry.carbs = entry_data.carbs
    if entry_data.fat is not None:
        entry.fat = entry_data.fat
    if entry_data.fiber is not None:
        entry.fiber = entry_data.fiber

    db.commit()
    return {"success": True, "message": "Entry updated"}

@app.delete("/api/food/{entry_id}")
async def delete_food_entry(
    entry_id: int,
    user: User = Depends(verify_password),
    db: Session = Depends(get_db)
):
    """Delete a food entry"""
    entry = db.query(FoodEntry).filter(
        FoodEntry.id == entry_id,
        FoodEntry.user_id == user.id
    ).first()
    
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    
    db.delete(entry)
    db.commit()
    
    return {"success": True, "message": "Entry deleted"}

# Water tracking
@app.post("/api/water/add")
async def add_water(
    request: AddWaterRequest,
    user: User = Depends(verify_password),
    db: Session = Depends(get_db)
):
    """Add water intake"""
    water_entry = WaterEntry(
        user_id=user.id,
        amount=request.amount
    )
    db.add(water_entry)
    db.commit()
    
    return {"success": True, "message": "Water added", "amount": request.amount}

@app.get("/api/water/today")
async def get_today_water(
    user: User = Depends(verify_password),
    db: Session = Depends(get_db)
):
    """Get today's total water intake"""
    from datetime import datetime, timedelta
    
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    
    entries = db.query(WaterEntry).filter(
        WaterEntry.user_id == user.id,
        WaterEntry.date >= today_start,
        WaterEntry.date < today_end
    ).all()
    
    total = sum(e.amount for e in entries)
    
    return {"total": total}

# Saved Meals
@app.post("/api/meals/save")
async def save_meal(
    request: SaveMealRequest,
    user: User = Depends(verify_password),
    db: Session = Depends(get_db)
):
    """Save a meal for reuse"""
    # Get the entries
    entries = db.query(FoodEntry).filter(
        FoodEntry.id.in_(request.entry_ids),
        FoodEntry.user_id == user.id
    ).all()
    
    if not entries:
        raise HTTPException(status_code=404, detail="No entries found")
    
    # Build items JSON
    items = []
    total_calories = 0
    total_protein = 0
    total_carbs = 0
    total_fat = 0
    total_fiber = 0
    
    for entry in entries:
        items.append({
            "food_item": entry.food_item,
            "quantity": entry.quantity,
            "unit": entry.unit,
            "calories": entry.calories,
            "protein": entry.protein,
            "carbs": entry.carbs,
            "fat": entry.fat,
            "fiber": entry.fiber,
            "sugar": entry.sugar,
            "saturated_fat": entry.saturated_fat,
            "micros_json": entry.micros_json
        })
        
        total_calories += entry.calories
        total_protein += entry.protein
        total_carbs += entry.carbs
        total_fat += entry.fat
        total_fiber += entry.fiber
    
    saved_meal = SavedMeal(
        user_id=user.id,
        name=request.name,
        meal_type=request.meal_type,
        items_json=json.dumps(items),
        total_calories=total_calories,
        total_protein=total_protein,
        total_carbs=total_carbs,
        total_fat=total_fat,
        total_fiber=total_fiber
    )
    
    db.add(saved_meal)
    db.commit()
    
    return {"success": True, "message": f"Meal '{request.name}' saved", "id": saved_meal.id}

@app.get("/api/meals/list")
async def list_saved_meals(
    user: User = Depends(verify_password),
    db: Session = Depends(get_db)
):
    """List all saved meals"""
    meals = db.query(SavedMeal).filter(SavedMeal.user_id == user.id).all()
    
    return {
        "meals": [
            {
                "id": m.id,
                "name": m.name,
                "meal_type": m.meal_type,
                "calories": m.total_calories,
                "protein": m.total_protein,
                "carbs": m.total_carbs,
                "fat": m.total_fat,
                "fiber": m.total_fiber
            } for m in meals
        ]
    }

@app.post("/api/meals/load/{meal_id}")
async def load_saved_meal(
    meal_id: int,
    user: User = Depends(verify_password),
    db: Session = Depends(get_db)
):
    """Load a saved meal and add entries for today"""
    meal = db.query(SavedMeal).filter(
        SavedMeal.id == meal_id,
        SavedMeal.user_id == user.id
    ).first()
    
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")
    
    items = json.loads(meal.items_json)
    
    # Create new entries for today
    new_entries = []
    for item in items:
        entry = FoodEntry(
            user_id=user.id,
            meal_type=meal.meal_type,
            food_item=item["food_item"],
            quantity=item["quantity"],
            unit=item["unit"],
            calories=item["calories"],
            protein=item["protein"],
            carbs=item["carbs"],
            fat=item["fat"],
            fiber=item["fiber"],
            sugar=item.get("sugar", 0),
            saturated_fat=item.get("saturated_fat", 0),
            micros_json=item.get("micros_json", "{}"),
            source_meal=meal.name
        )
        db.add(entry)
        new_entries.append(entry)
    
    db.commit()
    
    return {
        "success": True,
        "message": f"Loaded meal '{meal.name}'",
        "entries_added": len(new_entries)
    }
