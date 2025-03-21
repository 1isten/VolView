<template>
  <div v-if="roiMode">
    <span class="px-4 text-body2">ROI Histogram:</span>
    <div id="roi-histogram"></div>
  </div>
</template>

<script setup>
/* eslint-disable prefer-exponentiation-operator, no-restricted-properties */
import { computed, onMounted } from 'vue';
import { useUrlSearchParams } from '@vueuse/core';

defineProps({
  imageId: {
    required: true,
    type: [String, null],
  },
  groupId: {
    required: true,
    type: String,
  },
});

const query = useUrlSearchParams();
const roiMode = computed(() => query.roi === 'true' || query.roi === '1');

onMounted(() => {
  const Plotly = window.Plotly;
  if (!Plotly) {
    return;
  }
  const roiHistogramEl = document.getElementById('roi-histogram');
  if (roiHistogramEl) {
    // eslint-disable-next-line no-use-before-define
    roiHistogramEl.createHistogramWithNormalFit = createHistogramWithNormalFit;
    roiHistogramEl.deleteHistogram = () => Plotly.purge(roiHistogramEl);
  }
});

// Create histogram with normal distribution fit
function createHistogramWithNormalFit(stats) {
  const data = stats.data;
  const std = stats.std;
  const mean = stats.mean || 0;
  const skewness = stats.skewness || 0;
  const kurtosis = stats.kurtosis || 0;
  const similarity = stats.similarity;

  // Create points for normal distribution curve
  const normalX = [];
  const normalY = [];
  const min = stats.min - 2 * std;
  const max = stats.max + 2 * std;
  const step = Math.max(1, (max - min) / 100);

  for (let x = min; x <= max; x += step) {
    normalX.push(x);
    // Normal distribution formula: f(x) = (1 / (std * sqrt(2 * pi))) * e^(-(x - mean)^2 / (2 * std^2))
    const normalPdf = (1 / (std * Math.sqrt(2 * Math.PI))) *
      Math.exp(-(Math.pow(x - mean, 2) / (2 * Math.pow(std, 2))));
    normalY.push(normalPdf);
  }

  // Create histogram trace
  const histogramTrace = {
    x: data,
    type: 'histogram',
    histnorm: 'probability density',
    name: 'Histogram',
    marker: {
      color: 'rgba(52, 152, 219, 0.7)',  // Blue color with transparency
      line: {
        color: 'rgba(52, 152, 219, 1)',  // Solid blue for the outline
        width: 1
      }
    },
    nbinsx: 30
  };

  // Create normal distribution fit trace
  const normalFitTrace = {
    x: normalX,
    y: normalY,
    type: 'scatter',
    mode: 'lines',
    name: 'Normal Distribution Fit',
    line: {
      color: 'rgba(231, 76, 60, 0.9)',  // Red color
      width: 2
    }
  };

  // Create normality assessment text
  let normalityColor;
  switch (similarity) {
    case 'Excellent': normalityColor = 'rgba(46, 204, 113, 0.9)'; break; // Green
    case 'Good': normalityColor = 'rgba(52, 152, 219, 0.9)'; break; // Blue
    case 'Fair': normalityColor = 'rgba(230, 126, 34, 0.9)'; break; // Orange
    case 'Poor': normalityColor = 'rgba(231, 76, 60, 0.9)'; break; // Red
    default: normalityColor = 'rgba(149, 165, 166, 0.9)'; // Gray
  }

  // Maximum value for y-axis (used for vertical lines)
  const yMax = Math.max(...normalY);

  // Set layout with dark theme
  const layout = {
    // title: {
    //   text: 'ROI Histogram',
    //   font: {
    //     color: '#e0e0e0'
    //   }
    // },
    paper_bgcolor: '#1e2030',  // Background color of the chart paper
    plot_bgcolor: '#1e2030',   // Background color of the plotting area
    xaxis: {
      title: {
        text: 'Intensity Value',
        font: {
          color: '#e0e0e0'
        }
      },
      range: [stats.min - std, stats.max + std],
      color: '#e0e0e0',         // Axis color
      gridcolor: '#2c2e3e'      // Grid line color
    },
    yaxis: {
      title: {
        text: 'Probability Density',
        font: {
          color: '#e0e0e0'
        }
      },
      color: '#e0e0e0',         // Axis color
      gridcolor: '#2c2e3e'      // Grid line color
    },
    bargap: 0.05,
    legend: {
      x: 0.74,
      y: 1,
      font: {
        color: '#e0e0e0'
      },
      bgcolor: 'rgba(30, 32, 48, 0.7)'  // Semi-transparent dark background
    },
    annotations: [
      // Normality Assessment box with requested format
      {
        x: 0.02,  // Position at left side
        y: 0.98,  // Position near top
        xref: 'paper',
        yref: 'paper',
        text: `Normality: ${similarity}<br>Skewness: ${skewness.toFixed(3)}<br>Kurtosis: ${kurtosis.toFixed(3)}`,
        showarrow: false,
        font: {
          size: 12,
          color: 'white'
        },
        align: 'left',
        bgcolor: normalityColor,
        bordercolor: 'rgba(0,0,0,0.3)',
        borderwidth: 1,
        borderpad: 4,
        width: 170
      },
      // Mean label
      {
        x: mean,
        y: 0.98,
        xref: 'x',
        yref: 'paper',
        text: `Mean: ${mean.toFixed(2)}`,
        showarrow: false,
        font: {
          size: 11,
          color: '#3498db'  // Light blue
        },
        bgcolor: 'rgba(30, 32, 48, 0.8)',
        bordercolor: 'rgba(52, 152, 219, 0.5)',
        borderpad: 2
      },
      // Median label
      {
        x: stats.median,
        y: 0.91,  // Position slightly below the mean label
        xref: 'x',
        yref: 'paper',
        text: `Median: ${stats.median.toFixed(2)}`,
        showarrow: false,
        font: {
          size: 11,
          color: '#e0e0e0'  // Light gray
        },
        bgcolor: 'rgba(30, 32, 48, 0.8)',
        bordercolor: 'rgba(224, 224, 224, 0.5)',
        borderpad: 2
      }
    ],
    shapes: [
      // Standard deviation line (left)
      {
        type: 'line',
        x0: mean - std,
        y0: 0,
        x1: mean - std,
        y1: yMax,
        line: {
          color: 'rgba(231, 76, 60, 0.6)',  // Red with transparency
          width: 2,
          dash: 'dot'
        }
      },
      // Standard deviation line (right)
      {
        type: 'line',
        x0: mean + std,
        y0: 0,
        x1: mean + std,
        y1: yMax,
        line: {
          color: 'rgba(231, 76, 60, 0.6)',  // Red with transparency
          width: 2,
          dash: 'dot'
        }
      },
      // Mean line
      {
        type: 'line',
        x0: mean,
        y0: 0,
        x1: mean,
        y1: yMax,
        line: {
          color: '#3498db',  // Blue for mean
          width: 2,
          dash: 'solid'
        }
      },
      // Median line
      {
        type: 'line',
        x0: stats.median,
        y0: 0,
        x1: stats.median,
        y1: yMax,
        line: {
          color: '#e0e0e0',  // Light gray for median
          width: 2,
          dash: 'solid'
        }
      }
    ],
    margin: {
      // t: 80,  // Top margin
      // l: 70,  // Left margin
      // r: 70,  // Right margin
      // b: 70   // Bottom margin
    }
  };

  // eslint-disable-next-line no-undef
  Plotly.newPlot('roi-histogram', [histogramTrace, normalFitTrace], layout, {
    responsive: true,
    displaylogo: false,
    displayModeBar: true,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    toImageButtonOptions: {
      format: 'png',
      filename: 'roi_histogram',
      height: 600,
      width: 800,
      scale: 2
    }
  });
}
</script>

<style scoped>
#roi-histogram {
  width: 100%;
  height: 300px;
  overflow: hidden;
  background-color: #1e2030;
  border: 1px solid #3e4059;
  border-radius: 4px;
  margin-top: 4px;
  margin-bottom: 12px;
}
</style>
