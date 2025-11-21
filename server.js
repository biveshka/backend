import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Получить все тесты с вопросами и тегами
app.get('/api/tests', async (req, res) => {
  try {
    const { data: tests, error } = await supabase
      .from('tests')
      .select('*')
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Для каждого теста получаем вопросы и теги
    const testsWithDetails = await Promise.all(
      tests.map(async (test) => {
        const [questions, tags] = await Promise.all([
          // Получаем вопросы
          supabase
            .from('questions')
            .select('*')
            .eq('test_id', test.id)
            .order('order_index'),
          // Получаем теги
          supabase
            .from('test_tags')
            .select('tags(*)')
            .eq('test_id', test.id)
        ]);

        // Получаем отзывы и рейтинг
        const { data: reviews } = await supabase
          .from('test_reviews')
          .select('rating')
          .eq('test_id', test.id)
          .eq('is_approved', true);

        const average_rating = reviews && reviews.length > 0 
          ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length 
          : 0;

        return {
          ...test,
          questions: questions.data || [],
          tags: tags.data?.map(t => t.tags) || [],
          average_rating: parseFloat(average_rating.toFixed(1)),
          review_count: reviews?.length || 0
        };
      })
    );

    res.json(testsWithDetails);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Получить тест по ID
app.get('/api/tests/:id', async (req, res) => {
  try {
    const { data: test, error } = await supabase
      .from('tests')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;

    const [questions, tags, reviews] = await Promise.all([
      supabase
        .from('questions')
        .select('*')
        .eq('test_id', req.params.id)
        .order('order_index'),
      supabase
        .from('test_tags')
        .select('tags(*)')
        .eq('test_id', req.params.id),
      supabase
        .from('test_reviews')
        .select('*')
        .eq('test_id', req.params.id)
        .eq('is_approved', true)
    ]);

    res.json({
      ...test,
      questions: questions.data || [],
      tags: tags.data?.map(t => t.tags) || [],
      reviews: reviews.data || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Создать новый тест
app.post('/api/tests', async (req, res) => {
  try {
    const { title, description, questions, tags, created_by } = req.body;

    // Создаем тест
    const { data: test, error: testError } = await supabase
      .from('tests')
      .insert([
        {
          title,
          description,
          question_count: questions.length,
          total_points: questions.reduce((sum, q) => sum + (q.points || 1), 0),
          created_by,
          is_published: true
        }
      ])
      .select()
      .single();

    if (testError) throw testError;

    // Создаем вопросы
    const questionsWithTestId = questions.map((q, index) => ({
      test_id: test.id,
      question_text: q.question_text,
      options: q.options,
      correct_answer: q.correct_answer.toString(),
      points: q.points || 1,
      order_index: index
    }));

    const { error: questionsError } = await supabase
      .from('questions')
      .insert(questionsWithTestId);

    if (questionsError) throw questionsError;

    // Добавляем теги
    if (tags && tags.length > 0) {
      const testTags = tags.map(tag => ({
        test_id: test.id,
        tag_id: tag.id
      }));

      const { error: tagsError } = await supabase
        .from('test_tags')
        .insert(testTags);

      if (tagsError) throw tagsError;
    }

    // Логируем действие
    await supabase
      .from('admin_logs')
      .insert([
        {
          user_id: created_by,
          action_type: 'CREATE_TEST',
          description: `Создан тест: ${title}`
        }
      ]);

    res.json({ success: true, data: test });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Обновить тест
app.put('/api/tests/:id', async (req, res) => {
  try {
    const { title, description, questions, tags, updated_by } = req.body;

    // Обновляем тест
    const { data: test, error: testError } = await supabase
      .from('tests')
      .update({
        title,
        description,
        question_count: questions.length,
        total_points: questions.reduce((sum, q) => sum + (q.points || 1), 0),
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (testError) throw testError;

    // Удаляем старые вопросы
    await supabase
      .from('questions')
      .delete()
      .eq('test_id', req.params.id);

    // Создаем новые вопросы
    const questionsWithTestId = questions.map((q, index) => ({
      test_id: req.params.id,
      question_text: q.question_text,
      options: q.options,
      correct_answer: q.correct_answer.toString(),
      points: q.points || 1,
      order_index: index
    }));

    const { error: questionsError } = await supabase
      .from('questions')
      .insert(questionsWithTestId);

    if (questionsError) throw questionsError;

    // Обновляем теги
    await supabase
      .from('test_tags')
      .delete()
      .eq('test_id', req.params.id);

    if (tags && tags.length > 0) {
      const testTags = tags.map(tag => ({
        test_id: req.params.id,
        tag_id: tag.id
      }));

      const { error: tagsError } = await supabase
        .from('test_tags')
        .insert(testTags);

      if (tagsError) throw tagsError;
    }

    // Логируем действие
    await supabase
      .from('admin_logs')
      .insert([
        {
          user_id: updated_by,
          action_type: 'UPDATE_TEST',
          description: `Обновлен тест: ${title}`
        }
      ]);

    res.json({ success: true, data: test });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Удалить тест
app.delete('/api/tests/:id', async (req, res) => {
  try {
    const { user_id } = req.body;

    // Получаем информацию о тесте для лога
    const { data: test } = await supabase
      .from('tests')
      .select('title')
      .eq('id', req.params.id)
      .single();

    // Удаляем тест (каскадно удалятся вопросы и связи с тегами)
    const { error } = await supabase
      .from('tests')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    // Логируем действие
    await supabase
      .from('admin_logs')
      .insert([
        {
          user_id,
          action_type: 'DELETE_TEST',
          description: `Удален тест: ${test?.title || req.params.id}`
        }
      ]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Сохранить результат теста
app.post('/api/results', async (req, res) => {
  try {
    const { test_id, user_name, answers, score, total_questions, percentage } = req.body;

    const { data, error } = await supabase
      .from('results')
      .insert([
        {
          test_id,
          user_name: user_name || 'Anonymous',
          answers,
          score,
          total_questions,
          percentage
        }
      ])
      .select();

    if (error) throw error;
    res.json({ success: true, data: data[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Получить все результаты
app.get('/api/results', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('results')
      .select(`
        *,
        tests (
          title,
          description
        )
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Получить теги
app.get('/api/tags', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tags')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Аутентификация администратора
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .eq('password_hash', password)
      .eq('role', 'admin')
      .single();

    if (error || !user) {
      return res.status(401).json({ success: false, error: 'Неверные учетные данные' });
    }

    // Обновляем время последнего входа
    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Добавить отзыв
app.post('/api/reviews', async (req, res) => {
  try {
    const { test_id, user_name, rating, comment } = req.body;

    const { data, error } = await supabase
      .from('test_reviews')
      .insert([
        {
          test_id,
          rating,
          comment,
          user_id: null, // Можно привязать к пользователю если есть авторизация
          is_approved: true // В реальном приложении可能需要 модерация
        }
      ])
      .select();

    if (error) throw error;

    // Обновляем рейтинг теста
    await updateTestRating(test_id);

    res.json({ success: true, data: data[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Вспомогательная функция для обновления рейтинга теста
async function updateTestRating(testId) {
  const { data: reviews } = await supabase
    .from('test_reviews')
    .select('rating')
    .eq('test_id', testId)
    .eq('is_approved', true);

  if (reviews && reviews.length > 0) {
    const average_rating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    
    await supabase
      .from('tests')
      .update({
        average_rating: parseFloat(average_rating.toFixed(1)),
        review_count: reviews.length
      })
      .eq('id', testId);
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});