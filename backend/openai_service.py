import os
import json
from openai import OpenAI
from sqlalchemy.orm import Session
from database import CachedFood
from datetime import datetime

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

SYSTEM_PROMPT = """You are a nutrition analysis assistant for DockJock, a macro tracking app. Parse food entries and return detailed nutritional information.

INPUT FORMAT:
You receive food items, one per line:
- "2 eggs"
- "1 cup cooked white rice"
- "6 oz grilled chicken breast"

OUTPUT FORMAT:
Return ONLY valid JSON. No markdown blocks, no explanations, no preamble. Just raw JSON.

Structure:
{
  "items": [
    {
      "original_input": "2 eggs",
      "quantity": 2,
      "unit": "egg",
      "food_name": "egg",
      "per_unit_nutrition": {
        "calories": 70,
        "protein": 6,
        "carbs": 0.5,
        "fat": 5,
        "fiber": 0,
        "sugar": 0.4,
        "saturated_fat": 1.6,
        "micros": {
          "vitamin_a_mcg": 80,
          "vitamin_c_mg": 0,
          "vitamin_d_mcg": 1.1,
          "vitamin_e_mg": 0.5,
          "vitamin_k_mcg": 0.3,
          "vitamin_b1_thiamin_mg": 0.04,
          "vitamin_b2_riboflavin_mg": 0.2,
          "vitamin_b3_niacin_mg": 0.04,
          "vitamin_b6_mg": 0.07,
          "vitamin_b12_mcg": 0.6,
          "folate_mcg": 24,
          "choline_mg": 147,
          "calcium_mg": 28,
          "iron_mg": 0.9,
          "magnesium_mg": 6,
          "phosphorus_mg": 99,
          "potassium_mg": 69,
          "sodium_mg": 70,
          "zinc_mg": 0.6,
          "copper_mg": 0.04,
          "manganese_mg": 0.01,
          "selenium_mcg": 15.4
        }
      },
      "total_nutrition": {
        "calories": 140,
        "protein": 12,
        "carbs": 1,
        "fat": 10,
        "fiber": 0,
        "sugar": 0.8,
        "saturated_fat": 3.2,
        "micros": {
          (all micros × quantity)
        }
      }
    }
  ]
}

RULES:
1. Extract quantity (default 1 if missing)
2. Singular units: "egg" not "eggs"
3. Units: egg, slice, cup, tbsp, tsp, oz, lb, g, ml, piece
4. Use USDA FoodData Central data
5. per_unit_nutrition = 1 unit nutrition
6. total_nutrition = per_unit × quantity
7. Include ALL micronutrients available
8. If micro = 0, still include it as 0
9. Fractions: "1/2 cup" → 0.5
10. Return ONLY JSON - no markdown, no text
11. Cooked vs raw matters - respect the description
12. Be precise with measurements"""

def check_cache(food_name: str, db: Session):
    """Check if food is in cache"""
    cached = db.query(CachedFood).filter(CachedFood.food_name == food_name.lower()).first()
    return cached

def add_to_cache(food_name: str, unit: str, nutrition_data: dict, db: Session):
    """Add food to cache"""
    cached = CachedFood(
        food_name=food_name.lower(),
        unit=unit,
        nutrition_json=json.dumps(nutrition_data)
    )
    db.add(cached)
    db.commit()
    return cached

def parse_food_items(food_text: str, db: Session):
    """
    Parse food items using OpenAI API with smart caching
    Returns list of parsed items with nutrition data
    """
    lines = [line.strip() for line in food_text.strip().split('\n') if line.strip()]
    
    # Check cache first for each line
    results = []
    uncached_lines = []
    line_to_index = {}
    
    for idx, line in enumerate(lines):
        # Try to extract food name for cache lookup
        # Simple heuristic: remove numbers and common units from start
        words = line.lower().split()
        potential_food_name = None
        
        # Skip first word if it's a number or fraction
        start_idx = 0
        if words and (words[0].replace('.', '').replace('/', '').isdigit() or '/' in words[0]):
            start_idx = 1
        
        # Skip second word if it's a common unit
        common_units = ['cup', 'cups', 'tbsp', 'tsp', 'oz', 'lb', 'g', 'ml', 'slice', 'slices', 'piece', 'pieces']
        if len(words) > start_idx and words[start_idx] in common_units:
            start_idx += 1
        
        if len(words) > start_idx:
            potential_food_name = ' '.join(words[start_idx:])
            cached = check_cache(potential_food_name, db)
            
            if cached:
                # Found in cache! Calculate total based on quantity in original input
                cached_nutrition = json.loads(cached.nutrition_json)
                
                # Extract quantity from original line
                quantity = 1.0
                first_word = words[0] if words else "1"
                try:
                    if '/' in first_word:
                        parts = first_word.split('/')
                        quantity = float(parts[0]) / float(parts[1])
                    else:
                        quantity = float(first_word)
                except:
                    quantity = 1.0
                
                # Calculate total nutrition
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
                
                # Multiply micros
                if "micros" in cached_nutrition:
                    for key, value in cached_nutrition["micros"].items():
                        total_nutrition["micros"][key] = value * quantity
                
                results.append({
                    "original_input": line,
                    "quantity": quantity,
                    "unit": cached.unit,
                    "food_name": cached.food_name,
                    "per_unit_nutrition": cached_nutrition,
                    "total_nutrition": total_nutrition,
                    "from_cache": True
                })
                continue
        
        # Not in cache, need to query OpenAI
        uncached_lines.append(line)
        line_to_index[line] = idx
    
    # Query OpenAI for uncached items
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
                temperature=0.3
            )
            
            content = response.choices[0].message.content
            parsed_data = json.loads(content)
            
            # Add to cache and results
            for item in parsed_data.get("items", []):
                # Cache the per-unit nutrition
                add_to_cache(
                    item["food_name"],
                    item["unit"],
                    item["per_unit_nutrition"],
                    db
                )
                
                item["from_cache"] = False
                results.append(item)
        
        except Exception as e:
            raise Exception(f"OpenAI API error: {str(e)}")
    
    return results
