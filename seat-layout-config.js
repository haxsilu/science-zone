// Seat Layout Configuration
// This file defines the seat layout structure for exam bookings

const baseRows = [
  // Main block (right-hand side in the diagram)
  { row: 1, seats: 4, section: 'main', seatFlow: 'row', labelPosition: 'right' },
  { row: 2, seats: 4, section: 'main', seatFlow: 'row', labelPosition: 'right' },
  { row: 3, seats: 4, section: 'main', seatFlow: 'row', labelPosition: 'right' },
  { row: 4, seats: 4, section: 'main', seatFlow: 'row', labelPosition: 'right' },
  { row: 5, seats: 4, section: 'main', seatFlow: 'row', labelPosition: 'right' },
  { row: 6, seats: 4, section: 'main', seatFlow: 'row', labelPosition: 'right' },
];

const rows = baseRows.sort((a, b) => a.row - b.row);

const visualSections = [
  {
    id: 'main-block',
    layout: 'column',
    rows: [6, 5, 4, 3, 2, 1],
    description: 'Main hall block'
  }
];

module.exports = {
  rows,
  visualSections,

  // Total number of seats (calculated from rows)
  get totalSeats() {
    return this.rows.reduce((sum, r) => sum + r.seats, 0);
  },
  
  // Get maximum seats in any row
  get maxSeatsPerRow() {
    return Math.max(...this.rows.map(r => r.seats));
  },
  
  // Get number of seats for a specific row
  getSeatsForRow(rowIndex) {
    const row = this.rows.find(r => r.row === rowIndex);
    return row ? row.seats : 0;
  },
  
  // Validate seat position
  isValidSeat(rowIndex, seatPos) {
    const seats = this.getSeatsForRow(rowIndex);
    return seats > 0 && seatPos >= 1 && seatPos <= seats;
  },
  
  // Get all valid seat positions
  getAllSeats() {
    const allSeats = [];
    this.rows.forEach(row => {
      for (let pos = 1; pos <= row.seats; pos++) {
        allSeats.push({ row: row.row, pos });
      }
    });
    return allSeats;
  }
};
