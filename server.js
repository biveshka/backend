import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Инициализация Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Маршрут для получения тестов
app.get('/api/tests', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Маршрут для получения конкретного теста
app.get('/api/tests/:id', async (req, res) => {
  try {
    const { data: test, error } = await supabase
      .from('tests')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;

    // Получаем вопросы для теста
    const { data: questions, error: questionsError } = await supabase
      .from('questions')
      .select('*')
      .eq('test_id', req.params.id)
      .order('order_index');

    if (questionsError) throw questionsError;

    res.json({
      ...test,
      questions: questions || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Маршрут для сохранения результатов
app.post('/api/results', async (req, res) => {
  try {
    const { test_id, user_name, score, max_score, answers } = req.body;

    const { data, error } = await supabase
      .from('results')
      .insert([
        {
          test_id,
          user_name,
          score,
          max_score,
          answers,
          completed_at: new Date().toISOString()
        }
      ])
      .select();

    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Маршрут для получения результатов
app.get('/api/results/:test_id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('results')
      .select('*')
      .eq('test_id', req.params.test_id)
      .order('completed_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});