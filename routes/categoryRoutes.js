const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { requireAuth, checkRole } = require('../middleware/authMiddleware');

const SEEDS = [
  ['Handyman','General repairs, TV mounting, furniture assembly'],
  ['Plumbing','Pipe repairs, installations, leak fixing'],
  ['Electrical','Wiring, plugs, circuit breakers, appliance installation'],
  ['Painting','Interior and exterior painting services'],
  ['Gardening','Lawn mowing, tree trimming, general garden work'],
  ['House Cleaning','Domestic cleaning, deep cleans, post-construction cleaning'],
  ['Computer Repairs','Virus removal, hardware repairs, software installation'],
  ['Tutoring','Academic tutoring for all grades and subjects'],
  ['Graphic Design','Logos, flyers, branding, social media graphics'],
  ['Photography','Events, portraits, product photography'],
  ['Beauty Services','Haircuts, braiding, makeup, nails'],
  ['Appliance Repair','Washing machines, fridges, stoves, microwaves'],
];

router.get('/', async (req, res) => {
  try {
    let [cats] = await db.query('SELECT * FROM Categories WHERE IsActive=1 ORDER BY CategoryName');
    if (!cats.length) {
      for (const [name, desc] of SEEDS)
        await db.query('INSERT IGNORE INTO Categories (CategoryName,Description) VALUES (?,?)', [name, desc]);
      [cats] = await db.query('SELECT * FROM Categories WHERE IsActive=1 ORDER BY CategoryName');
    }
    res.json({ success: true, categories: cats });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load categories: ${err.message}` });
  }
});

router.post('/', requireAuth, checkRole('Admin'), async (req, res) => {
  try {
    const { categoryName, description } = req.body;
    if (!categoryName)
      return res.status(400).json({ success: false, message: 'Category name is required.' });
    await db.query('INSERT INTO Categories (CategoryName,Description) VALUES (?,?)', [categoryName.trim(), description || '']);
    res.status(201).json({ success: true, message: 'Category created.' });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not create category: ${err.message}` });
  }
});

router.put('/:id/toggle', requireAuth, checkRole('Admin'), async (req, res) => {
  try {
    await db.query('UPDATE Categories SET IsActive=NOT IsActive WHERE CategoryID=?', [req.params.id]);
    res.json({ success: true, message: 'Category updated.' });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not update category: ${err.message}` });
  }
});

module.exports = router;
