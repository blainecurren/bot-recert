const express = require('express');
const app = express();

app.get('/', (req, res) => {
    res.send('Test works!');
});

app.listen(3978, () => {
    console.log('Test server on 3978');
});