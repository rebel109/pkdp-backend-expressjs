const db = require('./config/db');

async function debugQuery() {
  try {
    const narasumberId = 213; // seraga
    const classId = 2; // Assuming 1B is class_id 2
    const videoTaskId = 15; // Assuming video task

    console.log(`\n=== DEBUG QUERY untuk assign ke Kelas 1B, Video Task ===\n`);

    // Simulasi targetSlots query SETELAH FIX
    console.log('--- TARGET SLOTS (untuk 1B) ---');
    const [targetSlots] = await db.query(`
      SELECT DISTINCT ss.id, ss.task_id, ss.slot_date, ss.start_time, ss.end_time
      FROM schedule_slots ss
      JOIN schedule_slot_classes ssc ON ssc.schedule_slot_id=ss.id
      WHERE ssc.class_id=? AND ss.task_id IN (?)
    `, [classId, videoTaskId]);

    console.log('Result:');
    targetSlots.forEach(slot => {
      console.log(`  ID: ${slot.id}, Jam: ${slot.start_time}-${slot.end_time}`);
    });

    // Simulasi otherSlots query SETELAH FIX
    console.log('\n--- OTHER SLOTS (seraga di kelas LAIN) ---');
    const [otherSlots] = await db.query(`
      SELECT DISTINCT ss.id, ss.slot_date, ss.start_time, ss.end_time
      FROM schedule_slot_classes ssc
      JOIN schedule_slots ss ON ss.id=ssc.schedule_slot_id
      WHERE ssc.narasumber_id=? AND ssc.class_id<>?
    `, [narasumberId, classId]);

    console.log('Result:');
    otherSlots.forEach(slot => {
      console.log(`  ID: ${slot.id}, Jam: ${slot.start_time}-${slot.end_time}`);
    });

    // Cek overlap
    console.log('\n--- OVERLAP CHECK ---');
    let hasOverlap = false;
    for (const ns of targetSlots) {
      for (const ex of otherSlots) {
        if (String(ns.slot_date) !== String(ex.slot_date)) {
          continue;
        }
        const overlap = ns.start_time < ex.end_time && ns.end_time > ex.start_time;
        console.log(`  Target: ${ns.start_time}-${ns.end_time}`);
        console.log(`  Other:  ${ex.start_time}-${ex.end_time}`);
        console.log(`  Overlap: ${ns.start_time} < ${ex.end_time} && ${ns.end_time} > ${ex.start_time} = ${overlap}`);
        if (overlap) {
          console.log(`  ❌ BENTROK!`);
          hasOverlap = true;
        }
        console.log('');
      }
    }

    if (!hasOverlap) {
      console.log('✅ Tidak ada overlap - seharusnya BERHASIL');
    }

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

debugQuery();
