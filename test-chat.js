const fetch = require('node-fetch');

async function testChat() {
  try {
    const response = await fetch('http://localhost:3001/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: 'test',
        message: 'How do I learn a backside 360?'
      })
    });
    
    const result = await response.json();
    console.log('Success!');
    console.log('Response:', result.response);
  } catch (error) {
    console.error('Error:', error);
  }
}

testChat();
