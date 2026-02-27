from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/dockjock.db")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    password_hash = Column(String, nullable=False)
    height = Column(Float, nullable=True)  # in cm
    weight = Column(Float, nullable=True)  # in kg
    calorie_goal = Column(Float, default=2000)
    protein_goal = Column(Float, default=150)
    carbs_goal = Column(Float, default=200)
    fat_goal = Column(Float, default=65)
    fiber_goal = Column(Float, default=30)
    water_goal = Column(Float, default=2000)  # in ml
    openai_model = Column(String, default="gpt-4o-mini")

class FoodEntry(Base):
    __tablename__ = "food_entries"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, default=1)
    date = Column(DateTime, default=datetime.utcnow)
    meal_type = Column(String, nullable=True)  # breakfast, lunch, dinner, snack, workout shake
    food_item = Column(String, nullable=False)
    quantity = Column(Float, default=1)
    unit = Column(String, nullable=True)
    calories = Column(Float, default=0)
    protein = Column(Float, default=0)
    carbs = Column(Float, default=0)
    fat = Column(Float, default=0)
    fiber = Column(Float, default=0)
    sugar = Column(Float, default=0)
    saturated_fat = Column(Float, default=0)
    micros_json = Column(String, nullable=True)  # JSON string of micronutrients
    source_meal = Column(String, nullable=True)  # name of saved meal if loaded from one

class CachedFood(Base):
    __tablename__ = "cached_foods"
    
    id = Column(Integer, primary_key=True, index=True)
    food_name = Column(String, unique=True, index=True, nullable=False)
    unit = Column(String, nullable=False)
    nutrition_json = Column(String, nullable=False)  # JSON with all nutrition data per unit
    created_at = Column(DateTime, default=datetime.utcnow)

class WaterEntry(Base):
    __tablename__ = "water_entries"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, default=1)
    date = Column(DateTime, default=datetime.utcnow)
    amount = Column(Float, default=0)  # in ml

class DailySummary(Base):
    __tablename__ = "daily_summaries"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, default=1)
    date = Column(DateTime, nullable=False)
    total_calories = Column(Float, default=0)
    total_protein = Column(Float, default=0)
    total_carbs = Column(Float, default=0)
    total_fat = Column(Float, default=0)
    total_fiber = Column(Float, default=0)
    total_water = Column(Float, default=0)
    goal_met = Column(Boolean, default=False)

class SavedMeal(Base):
    __tablename__ = "saved_meals"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, default=1)
    name = Column(String, nullable=False)
    meal_type = Column(String, nullable=True)
    items_json = Column(String, nullable=False)  # JSON string of food items with full nutrition
    total_calories = Column(Float, default=0)
    total_protein = Column(Float, default=0)
    total_carbs = Column(Float, default=0)
    total_fat = Column(Float, default=0)
    total_fiber = Column(Float, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

def init_db():
    Base.metadata.create_all(bind=engine)

    # Run migrations for columns added after initial schema
    with engine.connect() as conn:
        existing = [row[1] for row in conn.execute(
            __import__('sqlalchemy').text("PRAGMA table_info(food_entries)")
        )]
        if "source_meal" not in existing:
            conn.execute(__import__('sqlalchemy').text(
                "ALTER TABLE food_entries ADD COLUMN source_meal VARCHAR"
            ))
            conn.commit()

    # Create default user if doesn't exist
    db = SessionLocal()
    user = db.query(User).first()
    if not user:
        from passlib.hash import bcrypt
        default_password = os.getenv("ADMIN_PASSWORD", "Jay1234")
        user = User(password_hash=bcrypt.hash(default_password))
        db.add(user)
        db.commit()
    db.close()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
