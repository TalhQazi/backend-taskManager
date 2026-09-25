const axios = require('axios');

async function checkHeaderSettings() {
  try {
    const res = await axios.get('http://localhost:5000/api/admin/header-settings');
    console.log('Header Settings:', res.data);
  } catch (e) {
    console.error('Error fetching header settings:', e.response?.data || e.message);
  }
}

checkHeaderSettings();
