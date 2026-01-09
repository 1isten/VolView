<template>
  <div v-if="roiMode && plotlyLoaded" style="position: sticky; top: 100%;">
    <span class="px-4 text-body2">ROI Histogram:</span>
    <div id="roi-histogram"></div>
  </div>
</template>

<script setup>
/* eslint-disable prefer-exponentiation-operator, no-restricted-properties */
import { ref, computed, onMounted, nextTick } from 'vue';
import { useUrlSearchParams } from '@vueuse/core';

defineProps({
  imageId: {
    required: false,
    type: [String, null],
  },
  groupId: {
    required: true,
    type: String,
  },
});

const query = useUrlSearchParams();
const roiMode = computed(() => query.roi === 'true' || query.roi === '1');

const plotlyLoaded = ref(false);
let roiHistogramEl = null;

onMounted(() => {
  const Plotly = window.Plotly;
  if (Plotly) {
    plotlyLoaded.value = true;
  } else {
    return;
  }
  nextTick(() => {
    roiHistogramEl = document.getElementById('roi-histogram');
    if (roiHistogramEl) {
      // eslint-disable-next-line no-use-before-define
      roiHistogramEl.createHistogramWithNormalFit = createHistogramWithNormalFit;
      roiHistogramEl.deleteHistogram = () => Plotly.purge(roiHistogramEl);
    }
  })
});

// Create histogram with normal distribution fit
function createHistogramWithNormalFit(stats) {
  const data = stats.data;
  const { mean, std, similarity, skewness, kurtosis } = stats;

  // Create points for normal distribution curve
  const normalX = [];
  const normalY = [];
  const min = stats.min - 2 * std;
  const max = stats.max + 2 * std;
  const step = (max - min) / 100;

  if (step === 0) {
    return;
  }
  for (let x = min; x <= max; x += step) {
    normalX.push(x);
    // Normal distribution formula: f(x) = (1 / (std * sqrt(2 * pi))) * e^(-(x - mean)^2 / (2 * std^2))
    const normalPdf = (1 / (std * Math.sqrt(2 * Math.PI))) * Math.exp(-(Math.pow(x - mean, 2) / (2 * Math.pow(std, 2))));
    normalY.push(normalPdf);
  }

  // Create histogram trace - no name property for legend removal
  const histogramTrace = {
    x: data,
    type: 'histogram',
    histnorm: 'probability density',
    showlegend: false,  // Hide from legend
    marker: {
      color: 'rgba(52, 152, 219, 0.7)',  // Blue color with transparency
      line: {
        color: 'rgba(52, 152, 219, 1)',  // Solid blue for the outline
        width: 1
      }
    },
    nbinsx: 30
  };

  // Create normal distribution fit trace - no name property for legend removal
  const normalFitTrace = {
    x: normalX,
    y: normalY,
    type: 'scatter',
    mode: 'lines',
    showlegend: false,  // Hide from legend
    line: {
      color: 'rgba(231, 76, 60, 0.9)',  // Red color
      width: 2
    }
  };

  // Choose normality color
  let normalityColor;
  switch (similarity) {
    case 'Excellent': normalityColor = 'rgba(46, 204, 113, 0.9)'; break; // Green
    case 'Good': normalityColor = 'rgba(52, 152, 219, 0.9)'; break; // Blue
    case 'Fair': normalityColor = 'rgba(230, 126, 34, 0.9)'; break; // Orange
    case 'Poor': normalityColor = 'rgba(231, 76, 60, 0.9)'; break; // Red
    default: normalityColor = 'rgba(149, 165, 166, 0.9)'; // Gray
  }

  // Set layout with dark theme - simplified but keeping the normality box
  const layout = {
    paper_bgcolor: '#161c2f',  // Background color of the chart paper
    plot_bgcolor: '#161c2f',   // Background color of the plotting area
    xaxis: {
      range: [stats.min - std, stats.max + std],
      color: '#e0e0e0',         // Axis color
      gridcolor: '#2c2e3e',     // Grid line color
      showticklabels: true
    },
    yaxis: {
      color: '#e0e0e0',         // Axis color
      gridcolor: '#2c2e3e',     // Grid line color
      showticklabels: true
    },
    bargap: 0.05,
    // No legend configuration as we're removing the legend
    margin: {
      t: 30,  // Top margin
      l: 50,  // Left margin
      r: 20,  // Right margin
      b: 40   // Bottom margin
    },
    autosize: true,
    showlegend: false,  // Hide the legend completely
    annotations: [
      // Keep normality assessment box
      {
        x: 0.02,  // Position at left side
        y: 0.98,  // Position near top
        xref: 'paper',
        yref: 'paper',
        text: `${similarity}<br>Skewness: ${skewness.toFixed(2)}<br>Kurtosis: ${kurtosis.toFixed(2)}`, // Normality
        showarrow: false,
        font: {
          size: 10,
          color: 'white'
        },
        align: 'left',
        bgcolor: normalityColor,
        bordercolor: 'rgba(0,0,0,0.3)',
        borderwidth: 1,
        borderpad: 4,
        width: 90
      }
    ]
  };

  const Plotly = window.Plotly;
  if (!Plotly) {
    return;
  }
  // Plot chart with responsive setting and minimal mode bar
  Plotly.newPlot(roiHistogramEl, [histogramTrace, normalFitTrace], layout, {
    responsive: true,
    displaylogo: false,
    displayModeBar: false,  // Hide the mode bar
    scrollZoom: false,
    // staticPlot: true,
  });

  roiHistogramEl.roi_histogram = { mean, min, max };
}
</script>

<style scoped>
#roi-histogram {
  width: 100%;
  height: 280px;
  overflow: hidden;
  background-color: rgb(var(--v-theme-background));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  margin-top: 4px;
  margin-bottom: 12px;
}
</style>
