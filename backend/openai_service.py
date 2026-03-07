import os
import json
from openai import OpenAI
from sqlalchemy.orm import Session
from database import CachedFood
from datetime import datetime

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

SYSTEM_PROMPT = """You are a nutrition analysis assistant for DockJock, a macro tracking app. Parse food entries and return the TOTAL nutrition for the EXACT amount described.

INPUT FORMAT:
You receive food items, one per line:
- "2 eggs"
- "1 cup cooked white rice"
- "6 oz grilled chicken breast"
- "0.5 lb mushrooms"
- "1 lb 95% fat free ground beef"
- "Chick-fil-A 30-count Grilled Nuggets"

OUTPUT FORMAT:
Return ONLY valid JSON. No markdown blocks, no explanations, no preamble. Just raw JSON.

Structure:
{
  "items": [
    {
      "original_input": "6 oz grilled chicken breast",
      "quantity": 6,
      "unit": "oz",
      "food_name": "grilled chicken breast",
      "total_nutrition": {
        "calories": 187,
        "protein": 35,
        "carbs": 0,
        "fat": 4,
        "fiber": 0,
        "sugar": 0,
        "saturated_fat": 1,
        "micros": {
          "vitamin_a_mcg": 6,
          "vitamin_c_mg": 0,
          "vitamin_d_mcg": 0.1,
          "vitamin_e_mg": 0.3,
          "vitamin_k_mcg": 0.3,
          "vitamin_b1_thiamin_mg": 0.1,
          "vitamin_b2_riboflavin_mg": 0.15,
          "vitamin_b3_niacin_mg": 14,
          "vitamin_b6_mg": 0.9,
          "vitamin_b12_mcg": 0.3,
          "folate_mcg": 6,
          "choline_mg": 100,
          "calcium_mg": 15,
          "iron_mg": 1.0,
          "magnesium_mg": 27,
          "phosphorus_mg": 260,
          "potassium_mg": 470,
          "sodium_mg": 75,
          "zinc_mg": 1.0,
          "copper_mg": 0.06,
          "manganese_mg": 0.02,
          "selenium_mcg": 27
        }
      }
    }
  ]
}

RULES:
1. Extract quantity (default 1 if missing). Fractions: "1/2 cup" → quantity=0.5
2. Singular units: "egg" not "eggs", "nugget" not "nuggets"
3. Units: egg, slice, cup, tbsp, tsp, oz, lb, g, ml, piece, nugget, wing, strip, patty, scoop, serving
4. total_nutrition = the TOTAL nutrition for the EXACT amount described. NOT per-unit, NOT per-100g, NOT per serving size label.
5. For chain restaurants (Chick-fil-A, McDonald's, Chipotle, Subway, etc.) use the restaurant's OFFICIAL published nutrition facts — not estimates.
6. "X-count" means quantity=X pieces. Example: "30-count Grilled Nuggets" → total_nutrition = nutrition for all 30 nuggets combined.
7. WEIGHT UNIT EXAMPLES — follow these exactly:
   - "6 oz grilled chicken breast" → total_nutrition for 6 oz of chicken (~187 cal, 35g protein)
   - "0.5 lb mushrooms" → total_nutrition for half a pound of mushrooms (~49 cal, 6g protein)
   - "1 lb 95% fat free ground beef" → total_nutrition for a full pound (~560 cal, 97g protein, 16g fat)
   - "200g salmon" → total_nutrition for 200 grams of salmon (~415 cal, 41g protein)
8. REFERENCE TOTALS for common inputs:
   - 1 lb chicken breast (boneless skinless): ~490 cal, 92g protein, 0 carbs, 11g fat
   - 1 lb chicken thigh (boneless skinless): ~700 cal, 85g protein, 0 carbs, 40g fat
   - 1 lb ground beef 90/10: ~870 cal, 95g protein, 0 carbs, 50g fat
   - 1 lb ground beef 95/5 (95% lean): ~560 cal, 97g protein, 0 carbs, 16g fat
   - 1 lb ground beef 80/20: ~1150 cal, 82g protein, 0 carbs, 91g fat
   - 1 lb salmon: ~920 cal, 92g protein, 0 carbs, 59g fat
   - 1 lb raw mushrooms: ~97 cal, 13g protein, 14g carbs, 1.5g fat
   - 1 lb raw tomatoes: ~82 cal, 4g protein, 18g carbs, 0.9g fat
   - 6 oz grilled chicken breast: ~187 cal, 35g protein, 0 carbs, 4g fat
   - 2 large eggs: ~140 cal, 12g protein, 1g carbs, 10g fat
9. Include ALL micronutrients listed in the example. If micro = 0, still include it as 0.
10. Cooked vs raw matters — respect the description.
11. For lean ground beef (e.g. "95% fat free" or "95/5"): fat = ~16g per lb, calories = ~560 per lb.
12. Return ONLY JSON - no markdown, no text."""

# Units where the cache key must include the unit (different units = different nutrition per-unit)
UNIT_SENSITIVE = {'oz', 'lb', 'g', 'ml', 'cup', 'cups', 'tbsp', 'tsp'}

def _cache_key(food_name: str, unit: str) -> str:
    """Build cache key. For weight/volume units, include unit to prevent cross-unit collisions."""
    name = food_name.lower().strip()
    u = (unit or '').lower().strip()
    if u in UNIT_SENSITIVE:
        return f"{name}|{u}"
    return name

def check_cache(food_name: str, unit: str, db: Session):
    """Check if food+unit combo is in cache"""
    key = _cache_key(food_name, unit)
    return db.query(CachedFood).filter(CachedFood.food_name == key).first()

def add_to_cache(food_name: str, unit: str, nutrition_data: dict, db: Session):
    """Add food to cache with unit-aware key (stores per-unit nutrition), skip if already exists"""
    key = _cache_key(food_name, unit)
    existing = db.query(CachedFood).filter(CachedFood.food_name == key).first()
    if existing:
        return existing
    cached = CachedFood(
        food_name=key,
        unit=unit,
        nutrition_json=json.dumps(nutrition_data)
    )
    db.add(cached)
    db.commit()
    return cached

def _derive_per_unit(total_nutrition: dict, quantity: float) -> dict:
    """Divide total_nutrition by quantity to get per-unit values."""
    if quantity <= 0:
        quantity = 1.0
    per_unit = {}
    for k, v in total_nutrition.items():
        if k == "micros":
            per_unit["micros"] = {mk: mv / quantity for mk, mv in v.items()}
        elif isinstance(v, (int, float)):
            per_unit[k] = v / quantity
        else:
            per_unit[k] = v
    return per_unit

def parse_food_items(food_text: str, db: Session):
    """
    Parse food items using OpenAI API with smart caching.
    AI returns total_nutrition for the exact amount; per_unit is derived by dividing by quantity.
    Cache stores per-unit values. Cache keys are unit-aware: "mushroom|lb" and "mushroom|piece" are separate.
    """
    lines = [line.strip() for line in food_text.strip().split('\n') if line.strip()]

    results = []
    uncached_lines = []

    common_units = ['cup', 'cups', 'tbsp', 'tsp', 'oz', 'lb', 'g', 'ml',
                    'slice', 'slices', 'piece', 'pieces', 'nugget', 'nuggets',
                    'wing', 'wings', 'strip', 'strips', 'patty', 'scoop', 'serving']

    for idx, line in enumerate(lines):
        words = line.lower().split()

        # Extract quantity from first word
        extracted_quantity = 1.0
        start_idx = 0
        if words and (words[0].replace('.', '').replace('/', '').isdigit() or '/' in words[0]):
            start_idx = 1
            try:
                if '/' in words[0]:
                    parts = words[0].split('/')
                    extracted_quantity = float(parts[0]) / float(parts[1])
                else:
                    extracted_quantity = float(words[0])
            except:
                extracted_quantity = 1.0

        # Extract unit from next word if it's a known unit
        extracted_unit = None
        if len(words) > start_idx and words[start_idx] in common_units:
            extracted_unit = words[start_idx]
            start_idx += 1

        if len(words) > start_idx:
            potential_food_name = ' '.join(words[start_idx:])
            cached = check_cache(potential_food_name, extracted_unit or '', db)

            if cached:
                cached_nutrition = json.loads(cached.nutrition_json)  # per-unit values
                quantity = extracted_quantity

                total_nutrition = {
                    "calories": cached_nutrition["calories"] * quantity,
                    "protein": cached_nutrition["protein"] * quantity,
                    "carbs": cached_nutrition["carbs"] * quantity,
                    "fat": cached_nutrition["fat"] * quantity,
                    "fiber": cached_nutrition["fiber"] * quantity,
                    "sugar": cached_nutrition.get("sugar", 0) * quantity,
                    "saturated_fat": cached_nutrition.get("saturated_fat", 0) * quantity,
                    "micros": {}
                }

                if "micros" in cached_nutrition:
                    for key, value in cached_nutrition["micros"].items():
                        total_nutrition["micros"][key] = value * quantity

                results.append({
                    "original_input": line,
                    "quantity": quantity,
                    "unit": extracted_unit or cached.unit,
                    "food_name": potential_food_name,
                    "per_unit_nutrition": cached_nutrition,
                    "total_nutrition": total_nutrition,
                    "from_cache": True
                })
                continue

        uncached_lines.append(line)

    if uncached_lines:
        model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": "\n".join(uncached_lines)}
                ],
                response_format={"type": "json_object"},
                temperature=0.1
            )

            content = response.choices[0].message.content
            parsed_data = json.loads(content)

            for item in parsed_data.get("items", []):
                quantity = item.get("quantity", 1) or 1
                total = item["total_nutrition"]

                # Derive per-unit by dividing total by quantity — no AI math required
                per_unit = _derive_per_unit(total, quantity)

                # Cache the per-unit values
                add_to_cache(item["food_name"], item["unit"], per_unit, db)

                item["per_unit_nutrition"] = per_unit
                item["from_cache"] = False
                results.append(item)

        except Exception as e:
            raise Exception(f"OpenAI API error: {str(e)}")

    return results
