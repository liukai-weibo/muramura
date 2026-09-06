-- 今日饮食推荐 · 个人档案扩展（AI 提示词可编辑 + 体重支持一位小数）
-- 1) ai_prompt：用户生效的 AI 提示词全文；NULL = 使用内置默认提示词。
-- 2) weight_kg：SMALLINT 无法保留 81.5 这类小数，改为 DECIMAL(5,1) 支持原生体重秤精度（0.1kg）。

ALTER TABLE user_diet_profiles ADD COLUMN ai_prompt VARCHAR(2000) NULL AFTER health_note;
ALTER TABLE user_diet_profiles MODIFY COLUMN weight_kg DECIMAL(5,1) UNSIGNED NULL;