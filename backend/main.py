from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from sqlalchemy.orm import Session
from passlib.hash import bcrypt
from pydantic import BaseModel
from typing import Optional
import os
import json

from database import init_db, get_db, User, FoodEntry, CachedFood, WaterEntry, SavedMeal, WeightEntry
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
    name: Optional[str] = None
    goal: Optional[str] = None
    weigh_in_day: Optional[int] = None

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

class MealBuilderItem(BaseModel):
    food_item: str
    quantity: float
    unit: Optional[str] = ''
    calories: float
    protein: float
    carbs: float
    fat: float
    fiber: float

class CreateMealManualRequest(BaseModel):
    name: str
    meal_type: str
    items: list[MealBuilderItem]

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
        "name": user.name,
        "goal": user.goal,
        "height": user.height,
        "weight": user.weight,
        "calorie_goal": user.calorie_goal,
        "protein_goal": user.protein_goal,
        "carbs_goal": user.carbs_goal,
        "fat_goal": user.fat_goal,
        "fiber_goal": user.fiber_goal,
        "water_goal": user.water_goal,
        "openai_model": user.openai_model,
        "weigh_in_day": user.weigh_in_day if user.weigh_in_day is not None else 0
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
        # Also log a weight entry for today (upsert: replace if already logged today)
        from datetime import datetime, timedelta
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        today_end   = today_start + timedelta(days=1)
        existing_w  = db.query(WeightEntry).filter(
            WeightEntry.user_id == user.id,
            WeightEntry.date >= today_start,
            WeightEntry.date < today_end
        ).first()
        if existing_w:
            existing_w.weight_kg = settings.weight
        else:
            db.add(WeightEntry(user_id=user.id, weight_kg=settings.weight))
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
    if settings.name is not None:
        user.name = settings.name
    if settings.goal is not None:
        user.goal = settings.goal
    if settings.weigh_in_day is not None:
        user.weigh_in_day = settings.weigh_in_day

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
    db: Session = Depends(get_db),
    tz_offset: int = 0
):
    """Get today's food entries. tz_offset = JS getTimezoneOffset() (minutes behind UTC)."""
    from datetime import datetime, timedelta

    local_now = datetime.utcnow() - timedelta(minutes=tz_offset)
    local_today_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start = local_today_start + timedelta(minutes=tz_offset)
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
                "micros_json": e.micros_json,
                "time": e.date.isoformat()
            } for e in entries
        ],
        "totals": totals
    }


@app.get("/api/food/week")
async def get_week_entries(
    user: User = Depends(verify_password),
    db: Session = Depends(get_db),
    tz_offset: int = 0
):
    """Get last 7 days of food entries. tz_offset = JS getTimezoneOffset()."""
    from datetime import datetime, timedelta

    local_now = datetime.utcnow() - timedelta(minutes=tz_offset)
    local_today_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = local_today_start - timedelta(days=6)
    week_start_utc = week_start + timedelta(minutes=tz_offset)
    today_end_utc = local_today_start + timedelta(days=1) + timedelta(minutes=tz_offset)

    entries = db.query(FoodEntry).filter(
        FoodEntry.user_id == user.id,
        FoodEntry.date >= week_start_utc,
        FoodEntry.date < today_end_utc
    ).order_by(FoodEntry.date.asc()).all()

    return {
        "entries": [
            {
                "food_item": e.food_item,
                "micros_json": e.micros_json,
                "date": e.date.isoformat()
            } for e in entries
        ],
        "days": 7
    }


@app.get("/api/food/date")
async def get_entries_by_date(
    date: str,
    user: User = Depends(verify_password),
    db: Session = Depends(get_db),
    tz_offset: int = 0
):
    """Get food + water for a specific local date. date = YYYY-MM-DD."""
    from datetime import datetime, timedelta

    local_date = datetime.strptime(date, "%Y-%m-%d")
    day_start_utc = local_date + timedelta(minutes=tz_offset)
    day_end_utc   = day_start_utc + timedelta(days=1)

    entries = db.query(FoodEntry).filter(
        FoodEntry.user_id == user.id,
        FoodEntry.date >= day_start_utc,
        FoodEntry.date < day_end_utc
    ).order_by(FoodEntry.date.asc()).all()

    water_entries = db.query(WaterEntry).filter(
        WaterEntry.user_id == user.id,
        WaterEntry.date >= day_start_utc,
        WaterEntry.date < day_end_utc
    ).all()
    water_total = max(0, sum(e.amount for e in water_entries))

    totals = {
        "calories": sum(e.calories for e in entries),
        "protein":  sum(e.protein  for e in entries),
        "carbs":    sum(e.carbs    for e in entries),
        "fat":      sum(e.fat      for e in entries),
        "fiber":    sum(e.fiber    for e in entries),
    }

    return {
        "entries": [
            {
                "id":        e.id,
                "meal_type": e.meal_type,
                "food_item": e.food_item,
                "quantity":  e.quantity,
                "unit":      e.unit,
                "calories":  e.calories,
                "protein":   e.protein,
                "carbs":     e.carbs,
                "fat":       e.fat,
                "fiber":     e.fiber,
                "time":      e.date.isoformat()
            } for e in entries
        ],
        "totals": totals,
        "water_ml": water_total
    }


@app.get("/api/food/history/range")
async def get_history_range(
    start: str,
    end: str,
    user: User = Depends(verify_password),
    db: Session = Depends(get_db),
    tz_offset: int = 0
):
    """Get per-day macro summaries for a date range. start/end = YYYY-MM-DD."""
    from datetime import datetime, timedelta

    start_date = datetime.strptime(start, "%Y-%m-%d")
    end_date   = datetime.strptime(end,   "%Y-%m-%d")

    range_start_utc = start_date + timedelta(minutes=tz_offset)
    range_end_utc   = end_date   + timedelta(days=1, minutes=tz_offset)

    entries = db.query(FoodEntry).filter(
        FoodEntry.user_id == user.id,
        FoodEntry.date >= range_start_utc,
        FoodEntry.date < range_end_utc
    ).order_by(FoodEntry.date.asc()).all()

    water_entries = db.query(WaterEntry).filter(
        WaterEntry.user_id == user.id,
        WaterEntry.date >= range_start_utc,
        WaterEntry.date < range_end_utc
    ).all()

    # Group food by local date
    days_food = {}
    for e in entries:
        local_dt = e.date - timedelta(minutes=tz_offset)
        day_str  = local_dt.strftime("%Y-%m-%d")
        if day_str not in days_food:
            days_food[day_str] = {"calories": 0, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0}
        d = days_food[day_str]
        d["calories"] += e.calories
        d["protein"]  += e.protein
        d["carbs"]    += e.carbs
        d["fat"]      += e.fat
        d["fiber"]    += e.fiber

    # Group water by local date
    days_water = {}
    for e in water_entries:
        local_dt = e.date - timedelta(minutes=tz_offset)
        day_str  = local_dt.strftime("%Y-%m-%d")
        days_water[day_str] = days_water.get(day_str, 0) + e.amount

    # Build result for every day in range
    results = []
    current = start_date
    while current <= end_date:
        day_str = current.strftime("%Y-%m-%d")
        food = days_food.get(day_str, None)
        results.append({
            "date":     day_str,
            "calories": round(food["calories"]) if food else None,
            "protein":  round(food["protein"],  1) if food else None,
            "carbs":    round(food["carbs"],     1) if food else None,
            "fat":      round(food["fat"],       1) if food else None,
            "fiber":    round(food["fiber"],     1) if food else None,
            "water_ml": max(0, days_water.get(day_str, 0))
        })
        current += timedelta(days=1)

    return {"days": results}


@app.get("/api/food/export/csv")
async def export_csv(
    user: User = Depends(verify_password),
    db: Session = Depends(get_db),
    tz_offset: int = 0
):
    """Export all food entries as CSV."""
    from datetime import timedelta
    from fastapi.responses import StreamingResponse
    import io, csv

    entries = db.query(FoodEntry).filter(
        FoodEntry.user_id == user.id
    ).order_by(FoodEntry.date.asc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date", "Meal", "Food", "Qty", "Unit", "Calories", "Protein (g)", "Carbs (g)", "Fat (g)", "Fiber (g)"])
    for e in entries:
        local_dt = e.date - timedelta(minutes=tz_offset)
        writer.writerow([
            local_dt.strftime("%m/%d/%y"),
            e.meal_type or "",
            e.food_item,
            e.quantity,
            e.unit or "",
            round(e.calories),
            round(e.protein, 1),
            round(e.carbs,   1),
            round(e.fat,     1),
            round(e.fiber,   1)
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=dockjock_food_log.csv"}
    )


class MicroAnalysisRequest(BaseModel):
    period: str
    days: int
    micros: dict


@app.post("/api/micros/analyze")
async def analyze_micros(
    request: MicroAnalysisRequest,
    user: User = Depends(verify_password)
):
    """Use OpenAI to analyze micronutrient weaknesses."""
    from openai import OpenAI
    import os

    rda = {
        "vitamin_a_mcg": 900, "vitamin_c_mg": 90, "vitamin_d_mcg": 15,
        "vitamin_e_mg": 15, "vitamin_k_mcg": 120, "vitamin_b1_thiamin_mg": 1.2,
        "vitamin_b2_riboflavin_mg": 1.3, "vitamin_b3_niacin_mg": 16,
        "vitamin_b6_mg": 1.3, "vitamin_b12_mcg": 2.4, "folate_mcg": 400,
        "choline_mg": 550, "calcium_mg": 1000, "iron_mg": 8,
        "magnesium_mg": 420, "phosphorus_mg": 700, "potassium_mg": 3400,
        "sodium_mg": 2300, "zinc_mg": 11, "copper_mg": 0.9,
        "manganese_mg": 2.3, "selenium_mcg": 55
    }

    label_map = {
        "vitamin_a_mcg": "Vitamin A (mcg)", "vitamin_c_mg": "Vitamin C (mg)",
        "vitamin_d_mcg": "Vitamin D (mcg)", "vitamin_e_mg": "Vitamin E (mg)",
        "vitamin_k_mcg": "Vitamin K (mcg)", "vitamin_b1_thiamin_mg": "B1 Thiamin (mg)",
        "vitamin_b2_riboflavin_mg": "B2 Riboflavin (mg)", "vitamin_b3_niacin_mg": "B3 Niacin (mg)",
        "vitamin_b6_mg": "Vitamin B6 (mg)", "vitamin_b12_mcg": "Vitamin B12 (mcg)",
        "folate_mcg": "Folate (mcg)", "choline_mg": "Choline (mg)",
        "calcium_mg": "Calcium (mg)", "iron_mg": "Iron (mg)",
        "magnesium_mg": "Magnesium (mg)", "phosphorus_mg": "Phosphorus (mg)",
        "potassium_mg": "Potassium (mg)", "sodium_mg": "Sodium (mg)",
        "zinc_mg": "Zinc (mg)", "copper_mg": "Copper (mg)",
        "manganese_mg": "Manganese (mg)", "selenium_mcg": "Selenium (mcg)"
    }

    lines = []
    for key, rda_val in rda.items():
        avg = request.micros.get(key, 0)
        pct = round((avg / rda_val) * 100) if rda_val else 0
        lines.append(f"  {label_map[key]}: {round(avg, 1)} / {rda_val} ({pct}% of RDA)")

    period_label = "today" if request.period == "today" else f"the past {request.days} days (values are daily averages)"
    micro_data = "\n".join(lines)

    prompt = f"""You are a nutrition coach for a fitness-focused office worker. Analyze their micronutrient intake for {period_label}:

{micro_data}

Return ONLY valid JSON, no markdown:
{{
  "summary": "One sentence overall assessment (be direct and specific)",
  "deficiencies": [
    {{
      "nutrient": "Nutrient name",
      "pct_of_rda": 14,
      "foods": ["food 1", "food 2", "food 3"]
    }}
  ],
  "strengths": ["strength 1", "strength 2"]
}}

Rules:
- List top 3-5 deficiencies (lowest % of RDA first), skip any above 80%
- Foods should be practical, everyday options
- Strengths: only mention nutrients above 90% RDA
- Be concise"""

    try:
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.3
        )
        result = json.loads(response.choices[0].message.content)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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

@app.post("/api/cache/clear")
async def clear_food_cache(
    query: str = "",
    user: User = Depends(verify_password),
    db: Session = Depends(get_db)
):
    """Delete cached food entries matching a search string (or all if query is empty)."""
    q = db.query(CachedFood)
    if query:
        q = q.filter(CachedFood.food_name.ilike(f"%{query}%"))
    entries = q.all()
    for e in entries:
        db.delete(e)
    db.commit()
    return {"deleted": len(entries)}


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
    db: Session = Depends(get_db),
    tz_offset: int = 0
):
    """Get today's water intake. tz_offset = JS getTimezoneOffset() (minutes behind UTC)."""
    from datetime import datetime, timedelta

    local_now = datetime.utcnow() - timedelta(minutes=tz_offset)
    local_today_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start = local_today_start + timedelta(minutes=tz_offset)
    today_end = today_start + timedelta(days=1)
    
    entries = db.query(WaterEntry).filter(
        WaterEntry.user_id == user.id,
        WaterEntry.date >= today_start,
        WaterEntry.date < today_end
    ).all()
    
    total = max(0, sum(e.amount for e in entries))

    return {"total": total}


# Weight Tracking

class WeightLogRequest(BaseModel):
    weight_lbs: float

@app.post("/api/weight/log")
async def log_weight(
    request: WeightLogRequest,
    user: User = Depends(verify_password),
    db: Session = Depends(get_db),
    tz_offset: int = 0
):
    """Log a weight entry. Also updates user.weight (current weight)."""
    from datetime import timedelta
    weight_kg = request.weight_lbs / 2.20462
    entry = WeightEntry(user_id=user.id, weight_kg=weight_kg)
    db.add(entry)
    user.weight = weight_kg
    db.commit()
    return {"success": True}

@app.get("/api/weight/history")
async def get_weight_history(
    start: str,
    end: str,
    user: User = Depends(verify_password),
    db: Session = Depends(get_db),
    tz_offset: int = 0
):
    """Get weight entries for a date range. start/end = YYYY-MM-DD."""
    from datetime import datetime, timedelta
    start_dt = datetime.strptime(start, "%Y-%m-%d") + timedelta(minutes=tz_offset)
    end_dt   = datetime.strptime(end,   "%Y-%m-%d") + timedelta(days=1, minutes=tz_offset)

    entries = db.query(WeightEntry).filter(
        WeightEntry.user_id == user.id,
        WeightEntry.date >= start_dt,
        WeightEntry.date < end_dt
    ).order_by(WeightEntry.date.asc()).all()

    # One entry per day (last entry of each day)
    by_day = {}
    for e in entries:
        local_dt = e.date - timedelta(minutes=tz_offset)
        day_str  = local_dt.strftime("%Y-%m-%d")
        by_day[day_str] = round(e.weight_kg * 2.20462, 1)  # return as lbs

    return {"entries": [{"date": k, "weight_lbs": v} for k, v in sorted(by_day.items())]}

@app.get("/api/weight/today")
async def get_today_weight(
    user: User = Depends(verify_password),
    db: Session = Depends(get_db),
    tz_offset: int = 0
):
    """Check if a weight entry exists for today."""
    from datetime import datetime, timedelta
    local_now = datetime.utcnow() - timedelta(minutes=tz_offset)
    day_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(minutes=tz_offset)
    day_end   = day_start + timedelta(days=1)
    entry = db.query(WeightEntry).filter(
        WeightEntry.user_id == user.id,
        WeightEntry.date >= day_start,
        WeightEntry.date < day_end
    ).first()
    return {"logged_today": entry is not None}


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
                "fiber": m.total_fiber,
                "items": json.loads(m.items_json) if m.items_json else []
            } for m in meals
        ]
    }

def _build_meal_items_json(items):
    return json.dumps([{
        "food_item": i.food_item, "quantity": i.quantity, "unit": i.unit or '',
        "calories": i.calories, "protein": i.protein, "carbs": i.carbs,
        "fat": i.fat, "fiber": i.fiber, "sugar": 0, "saturated_fat": 0, "micros_json": "{}"
    } for i in items])

@app.post("/api/meals/create")
async def create_meal_manual(
    request: CreateMealManualRequest,
    user: User = Depends(verify_password),
    db: Session = Depends(get_db)
):
    """Create a saved meal from manually entered items"""
    saved_meal = SavedMeal(
        user_id=user.id,
        name=request.name,
        meal_type=request.meal_type,
        items_json=_build_meal_items_json(request.items),
        total_calories=sum(i.calories for i in request.items),
        total_protein=sum(i.protein  for i in request.items),
        total_carbs=sum(i.carbs    for i in request.items),
        total_fat=sum(i.fat      for i in request.items),
        total_fiber=sum(i.fiber    for i in request.items),
    )
    db.add(saved_meal)
    db.commit()
    return {"success": True, "id": saved_meal.id}

@app.put("/api/meals/{meal_id}")
async def update_saved_meal(
    meal_id: int,
    request: CreateMealManualRequest,
    user: User = Depends(verify_password),
    db: Session = Depends(get_db)
):
    """Update an existing saved meal"""
    meal = db.query(SavedMeal).filter(SavedMeal.id == meal_id, SavedMeal.user_id == user.id).first()
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")
    meal.name          = request.name
    meal.meal_type     = request.meal_type
    meal.items_json    = _build_meal_items_json(request.items)
    meal.total_calories = sum(i.calories for i in request.items)
    meal.total_protein  = sum(i.protein  for i in request.items)
    meal.total_carbs    = sum(i.carbs    for i in request.items)
    meal.total_fat      = sum(i.fat      for i in request.items)
    meal.total_fiber    = sum(i.fiber    for i in request.items)
    db.commit()
    return {"success": True}

@app.delete("/api/meals/{meal_id}")
async def delete_saved_meal(
    meal_id: int,
    user: User = Depends(verify_password),
    db: Session = Depends(get_db)
):
    """Delete a saved meal"""
    meal = db.query(SavedMeal).filter(SavedMeal.id == meal_id, SavedMeal.user_id == user.id).first()
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")
    db.delete(meal)
    db.commit()
    return {"success": True}

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
