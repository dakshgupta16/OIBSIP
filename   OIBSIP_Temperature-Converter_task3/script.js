document.addEventListener('DOMContentLoaded', () => {
    const temperatureInput = document.getElementById('temperature-input');
    const fromUnitSelect = document.getElementById('from-unit-select');
    const toUnitSelect = document.getElementById('to-unit-select');
    const convertButton = document.getElementById('convert-button');
    const resultDisplay = document.getElementById('result-display');
    const errorMessage = document.getElementById('error-message');

    convertButton.addEventListener('click', () => {
        const inputValue = temperatureInput.value;
        const fromUnit = fromUnitSelect.value;
        const toUnit = toUnitSelect.value;
        
        if (isNaN(inputValue) || inputValue.trim() === '') {
            errorMessage.textContent = 'Please enter a valid number.';
            errorMessage.style.visibility = 'visible';
            resultDisplay.textContent = '';
            return;
        } else {
            errorMessage.style.visibility = 'hidden';
        }

        const temperature = parseFloat(inputValue);
        let convertedTemperature;
        let resultUnit;

        // Case 1: Converting FROM Celsius
        if (fromUnit === 'celsius') {
            if (toUnit === 'fahrenheit') {
                convertedTemperature = (temperature * 9/5) + 32;
                resultUnit = '°F';
            } else if (toUnit === 'kelvin') {
                convertedTemperature = temperature + 273.15;
                resultUnit = 'K';
            } else {
                convertedTemperature = temperature;
                resultUnit = '°C';
            }
        }
        
        // Case 2: Converting FROM Fahrenheit
        else if (fromUnit === 'fahrenheit') {
            if (toUnit === 'celsius') {
                convertedTemperature = (temperature - 32) * 5/9;
                resultUnit = '°C';
            } else if (toUnit === 'kelvin') {
                convertedTemperature = ((temperature - 32) * 5/9) + 273.15;
                resultUnit = 'K';
            } else {
                convertedTemperature = temperature;
                resultUnit = '°F';
            }
        }
        
        // Case 3: Converting FROM Kelvin
        else if (fromUnit === 'kelvin') {
            if (toUnit === 'celsius') {
                convertedTemperature = temperature - 273.15;
                resultUnit = '°C';
            } else if (toUnit === 'fahrenheit') {
                convertedTemperature = ((temperature - 273.15) * 9/5) + 32;
                resultUnit = '°F';
            } else {
                convertedTemperature = temperature;
                resultUnit = 'K';
            }
        }

        const finalResult = convertedTemperature.toFixed(2);
        
        resultDisplay.textContent = `${finalResult} ${resultUnit}`;
    });
});
