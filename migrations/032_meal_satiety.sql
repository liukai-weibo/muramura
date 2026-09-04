ALTER TABLE meal_entries DROP CHECK meal_entries_feeling_check;

-- 三餐「餐后感受 1-5」→「饱腹度 {0,5,7,9}」语义转换
-- 值域语义：0=未填写（默认，非可选档位），5=五分饱，7=七分饱，9=九分饱
-- 历史数据映射（阈值折算，保留记录含义）：
--   1（不太舒服）/2（平平淡淡）→ 5（五分饱，吃少/没怎么吃）
--   3（刚刚好）→ 7（七分饱）
--   4（吃得开心）/5（超满足）→ 9（九分饱）
-- 未修改任何已应用 Migration，仅新建 032；032 幂等：映射已完成为 0/5/7/9 时不再改。
-- 应用前必须备份 meal_entries；执行顺序：先清旧 CHECK、再映射、再落新 CHECK。
UPDATE meal_entries
SET feeling = CASE
  WHEN feeling IN (1, 2) THEN 5
  WHEN feeling = 3 THEN 7
  WHEN feeling IN (4, 5) THEN 9
  ELSE feeling
END;
ALTER TABLE meal_entries ADD CONSTRAINT meal_entries_feeling_check CHECK (feeling IN (0, 5, 7, 9));