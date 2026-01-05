const supabase = require('../config/db');

// CREATE - New order with items
const createOrder = async (req, res) => {
  try {
    const { booking_id, items } = req.body; // items = [{menu_item_id, quantity}, ...]
    // Payment recording is handled separately via payment transaction API
    let userId = req.user.user_id || req.user.id;
    
    // console.log('=== createOrder called ===');
    // console.log('booking_id:', booking_id, 'items:', items);
    // console.log('userId:', userId);

    if (!booking_id || !items || items.length === 0) {
      return res.status(400).json({ error: 'Booking ID and items are required' });
    }

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const bookingId = parseInt(booking_id, 10);
    const userIdInt = typeof userId === 'string' && /^\d+$/.test(userId) ? parseInt(userId, 10) : userId;

    // Verify booking exists and status is "checkin"
    // console.log('Verifying booking status...');
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('booking_id, status')
      .eq('booking_id', bookingId)
      .single();

    if (bookingError || !booking) {
      console.error('Booking not found:', bookingError);
      return res.status(404).json({ error: 'Booking not found' });
    }

    // console.log('Booking status:', booking.status);
    
    // Check if booking status is a checked-in status (handle multiple formats)
    const validStatuses = ['checkin', 'checked-in', 'checked in'];
    const isCheckedIn = validStatuses.includes(booking.status?.toLowerCase());
    
    if (!isCheckedIn) {
      console.warn(`⚠️  Cannot create food order - booking status is: ${booking.status}`);
      return res.status(400).json({ 
        error: `Food orders only available for checked-in bookings. Current status: ${booking.status}` 
      });
    }

    // Create order - Set amount_paid to 0 initially
    // Payment will be recorded separately via payment transaction API
    // console.log('Creating new order for booking:', bookingId);
    const { data: newOrder, error: createError } = await supabase
      .from('food_orders')
      .insert([
        {
          booking_id: bookingId,
          user_id: userIdInt,
          status: 'pending',
          total_amount: 0,
          amount_paid: 0,
          amount_due: 0
        }
      ])
      .select();

    if (createError || !newOrder || newOrder.length === 0) {
      console.error('❌ Error creating order:', createError);
      return res.status(500).json({ error: 'Failed to create order', details: createError?.message });
    }

    const orderId = newOrder[0].id;
    // console.log('✅ Order created:', orderId);

    // Add items to order
    let totalAmount = 0;
    const itemsToInsert = [];

    for (const item of items) {
      const { menu_item_id, quantity } = item;

      if (!menu_item_id || !quantity || quantity <= 0) {
        continue;
      }

      // Get menu item price
      const { data: menuItem, error: menuError } = await supabase
        .from('menu_items')
        .select('id, name, price')
        .eq('id', menu_item_id)
        .single();

      if (menuError || !menuItem) {
        console.warn('Menu item not found:', menu_item_id);
        continue;
      }

      const price = menuItem.price;
      const itemTotal = price * quantity;
      totalAmount += itemTotal;

      itemsToInsert.push({
        order_id: orderId,
        menu_item_id,
        quantity,
        price
      });

      // console.log('📝 Item:', menuItem.name, 'Qty:', quantity, 'Price:', price, 'Total:', itemTotal);
    }

    if (itemsToInsert.length === 0) {
      return res.status(400).json({ error: 'No valid items provided' });
    }

    // Insert all items
    const { data: orderItems, error: insertError } = await supabase
      .from('food_order_items')
      .insert(itemsToInsert)
      .select();

    if (insertError) {
      console.error('❌ Error inserting items:', insertError);
      return res.status(500).json({ error: 'Failed to add items', details: insertError.message });
    }

    // Update order total with 5% GST included - amount_due equals total initially
    // Payment will be recorded separately via payment transaction API which will update amount_paid
    const totalWithGST = totalAmount * 1.05; // Add 5% GST
    const { data: updatedOrder, error: updateError } = await supabase
      .from('food_orders')
      .update({ 
        total_amount: totalWithGST,
        amount_due: totalWithGST
      })
      .eq('id', orderId)
      .select();

    if (updateError) {
      console.error('❌ Error updating order total:', updateError);
      return res.status(500).json({ error: 'Failed to update order total', details: updateError.message });
    }

    // Create KOT history entry for this initial order
    // Enrich orderItems with menu item names
    const enrichedItems = [];
    for (const item of orderItems || []) {
      const { data: menuItem } = await supabase
        .from('menu_items')
        .select('id, name')
        .eq('id', item.menu_item_id)
        .single();

      enrichedItems.push({
        id: item.id,
        menu_item_id: item.menu_item_id,
        name: menuItem?.name || item.menu_item_id,
        quantity: item.quantity,
        price: item.price
      });
    }

    const kotData = {
      food_order_id: orderId,
      booking_id: bookingId,
      user_id: userIdInt,
      kot_type: 'initial',
      total_items: enrichedItems.length,
      total_amount: totalAmount,
      amount_paid: 0,
      amount_due: totalAmount,
      items_snapshot: enrichedItems,
      new_items_snapshot: null,
      kot_date: new Date().toISOString()
    };

    const { data: kotEntry, error: kotError } = await supabase
      .from('food_order_history')
      .insert([kotData])
      .select();

    if (kotError) {
      console.error('Warning: Could not create KOT history entry:', kotError);
      // Don't fail the order creation if KOT history fails
    } else {
      // console.log('✅ Initial KOT history created:', kotEntry?.[0]?.id);
    }

    // console.log('💰 Order total set:', { orderId, total_amount: totalAmount, amount_paid: 0, amount_due: totalAmount });
    
    // console.log('\n' + '='.repeat(70));
    // console.log('✅ NEW ORDER CREATED SUCCESSFULLY');
    // console.log('='.repeat(70));
    // console.log('Order ID:', orderId);
    // console.log('Booking ID:', bookingId);
    // console.log('Total Amount: ₹' + totalAmount.toFixed(2));
    // console.log('Amount Paid: ₹' + (amount_paid || 0).toFixed(2));
    // console.log('Amount Due: ₹' + totalAmount.toFixed(2));
    // console.log('Total Items:', orderItems?.length || 0);
    
    orderItems?.forEach((item, idx) => {
      // console.log(`  ${idx + 1}. Item ID: ${item.id} | Menu Item: ${item.menu_item_id} | Qty: ${item.quantity} | Price: ₹${item.price}`);
    });
    
    // console.log('='.repeat(70) + '\n');

    res.json({ 
      order: updatedOrder[0] || { ...newOrder[0], total_amount: totalAmount, amount_paid: 0, amount_due: totalAmount }, 
      items: orderItems, 
      total_amount: totalAmount,
      amount_paid: 0,
      amount_due: totalAmount
    });
  } catch (err) {
    console.error('❌ Error in createOrder:', err);
    res.status(500).json({ error: 'Failed to create order', details: err.message });
  }
};

// UPDATE - Modify existing order (add/update/remove items)
const updateOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { items } = req.body; // items = [{menu_item_id, quantity, itemId?}, ...] 
    // itemId exists for existing items, null for new items, quantity 0 = delete
    // Payment updates should be done separately via payment API

    // console.log('=== updateOrder called ===');
    // console.log('orderId:', orderId, 'items to update:', items);

    if (!orderId || !items || items.length === 0) {
      return res.status(400).json({ error: 'Order ID and items are required' });
    }

    // Verify order exists
    const { data: order, error: orderError } = await supabase
      .from('food_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('Order not found:', orderError);
      return res.status(404).json({ error: 'Order not found' });
    }

    // console.log('✅ Order found:', orderId);

    // Verify booking status is "checkin"
    // console.log('Verifying booking status for booking_id:', order.booking_id);
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('booking_id, status')
      .eq('booking_id', order.booking_id)
      .single();

    if (bookingError || !booking) {
      console.error('Booking not found:', bookingError);
      return res.status(404).json({ error: 'Booking not found' });
    }

    // console.log('Booking status:', booking.status);
    
    // Check if booking status is a checked-in status (handle multiple formats)
    const validStatuses = ['checkin', 'checked-in', 'checked in'];
    const isCheckedIn = validStatuses.includes(booking.status?.toLowerCase());
    
    if (!isCheckedIn) {
      console.warn(`⚠️  Cannot update food order - booking status is: ${booking.status}`);
      return res.status(400).json({ 
        error: `Food orders can only be updated for checked-in bookings. Current status: ${booking.status}` 
      });
    }

    // First, get all existing items in the order
    const { data: existingItems, error: existingError } = await supabase
      .from('food_order_items')
      .select('*')
      .eq('order_id', orderId);

    if (existingError) {
      console.error('Error fetching existing items:', existingError);
    }

    // Track which existing items are being modified
    const existingItemsMap = new Map();
    if (existingItems && existingItems.length > 0) {
      for (const item of existingItems) {
        existingItemsMap.set(item.id, item);
      }
    }

    // Process items and prepare modifications
    let totalAmount = 0;
    const itemsToInsert = [];
    const itemsToDelete = [];
    const itemsToUpdate = [];

    // console.log('🔍 Processing items:');
    for (const item of items) {
      const { menu_item_id, quantity, itemId } = item;

      // console.log(`  Item: menu_item_id=${menu_item_id}, quantity=${quantity}, itemId=${itemId}`);

      if (!menu_item_id) continue;

      // Check for deletion: quantity is 0 AND itemId exists (means existing DB item to delete)
      if (quantity === 0 && itemId) {
        // console.log(`  ❌ DELETE: Marking item ${itemId} for deletion`);
        itemsToDelete.push(itemId);
        existingItemsMap.delete(itemId);  // Remove from map since it's being deleted
        continue;
      }

      // Skip items with quantity <= 0 (except deletion case handled above)
      if (quantity <= 0) {
        // console.log(`  ⏭️  SKIP: Invalid quantity ${quantity}`);
        continue;
      }

      // Get menu item price
      const { data: menuItem, error: menuError } = await supabase
        .from('menu_items')
        .select('id, name, price')
        .eq('id', menu_item_id)
        .single();

      if (menuError || !menuItem) {
        console.warn(`  ⚠️  SKIP: Menu item ${menu_item_id} not found`);
        continue;
      }

      const price = menuItem.price;
      const itemTotal = price * quantity;

      if (itemId) {
        // UPDATE existing item
        // console.log(`  ✏️  UPDATE: item ${itemId}, qty=${quantity}, price=${price}, total=${itemTotal}`);
        itemsToUpdate.push({ itemId, quantity, price });
        // Mark this item as updated in the map
        existingItemsMap.set(itemId, { ...existingItemsMap.get(itemId), quantity, price });
      } else {
        // ADD new item (no itemId means it's a new item being added to order)
        // console.log(`  ➕ INSERT: menu_item_id=${menu_item_id}, qty=${quantity}, price=${price}, total=${itemTotal}`);
        itemsToInsert.push({
          order_id: orderId,
          menu_item_id,
          quantity,
          price
        });
      }
    }

    // Now calculate the total from:
    // 1. Existing items that remain unchanged (still in map, not deleted or updated)
    // 2. Updated items (updated quantities/prices)
    // 3. Newly inserted items
    for (const item of existingItemsMap.values()) {
      totalAmount += (item.quantity * item.price);
    }
    
    // Add new items total
    for (const item of itemsToInsert) {
      totalAmount += (item.quantity * item.price);
    }

    // console.log(`📊 Summary: ${itemsToUpdate.length} updates, ${itemsToInsert.length} inserts, ${itemsToDelete.length} deletes, Total: ₹${totalAmount.toFixed(2)}`);

    // UPDATE existing items
    for (const item of itemsToUpdate) {
      // console.log(`🔄 UPDATING item ${item.itemId}: qty=${item.quantity}, price=${item.price}`);
      const { error: updateError } = await supabase
        .from('food_order_items')
        .update({ quantity: item.quantity, price: item.price })
        .eq('id', item.itemId)
        .eq('order_id', orderId);
      
      if (updateError) {
        console.error(`❌ Error updating item ${item.itemId}:`, updateError);
      } else {
        // console.log(`✅ Item ${item.itemId} updated successfully`);
      }
    }
    if (itemsToUpdate.length > 0) {
      // console.log(`✅ TOTAL: ${itemsToUpdate.length} items updated`);
    }

    // Delete items marked for deletion
    if (itemsToDelete.length > 0) {
      // console.log(`\n🗑️  DELETING ${itemsToDelete.length} items:`, itemsToDelete);
      for (const itemId of itemsToDelete) {
        // console.log(`  ❌ Deleting item ID: ${itemId}`);
      }
      
      const { error: deleteError } = await supabase
        .from('food_order_items')
        .delete()
        .in('id', itemsToDelete)
        .eq('order_id', orderId);
      
      if (deleteError) {
        console.error(`❌ Error deleting items:`, deleteError);
      } else {
        // console.log(`✅ TOTAL: ${itemsToDelete.length} items deleted successfully\n`);
      }
    }

    // Insert new items
    if (itemsToInsert.length > 0) {
      // console.log(`\n➕ INSERTING ${itemsToInsert.length} new items:`);
      itemsToInsert.forEach(item => {
        // console.log(`  ➕ Adding: menu_item_id=${item.menu_item_id}, qty=${item.quantity}, price=${item.price}`);
      });
      
      const { data: insertedItems, error: insertError } = await supabase
        .from('food_order_items')
        .insert(itemsToInsert)
        .select();
      
      if (insertError) {
        console.error(`❌ Error inserting items:`, insertError);
      } else {
        // console.log(`✅ TOTAL: ${itemsToInsert.length} new items inserted successfully`);
        insertedItems?.forEach(item => {
          // console.log(`  ✅ Inserted with ID: ${item.id}`);
        });
      }
    }

    // Calculate FULL order total: existing items (with remaining qty) + new items
    // Get all items in order (both existing and newly inserted)
    const { data: allOrderItems, error: allItemsError } = await supabase
      .from('food_order_items')
      .select('quantity, voided_quantity, price')
      .eq('order_id', orderId);
    
    let fullOrderTotal = 0;
    if (allOrderItems && allOrderItems.length > 0) {
      const baseTotal = allOrderItems.reduce((sum, item) => {
        const remaining = (item.quantity || 0) - (item.voided_quantity || 0);
        return sum + ((item.price || 0) * Math.max(0, remaining));
      }, 0);
      // Apply 5% GST to full order total
      fullOrderTotal = baseTotal * 1.05;
    }

    // Update order total and recalculate amount_due based on existing payments
    // Preserve the existing amount_paid as payments are tracked separately
    const currentAmountPaid = order.amount_paid || 0;
    const finalAmountDue = Math.max(0, fullOrderTotal - currentAmountPaid);
    await supabase
      .from('food_orders')
      .update({ 
        total_amount: fullOrderTotal,
        amount_due: finalAmountDue
      })
      .eq('id', orderId);

    // Create KOT history entry if new items were added (additions)
    if (itemsToInsert.length > 0) {
      // console.log('🔍 itemsToInsert count:', itemsToInsert.length);
      itemsToInsert.forEach((item, idx) => {
        // console.log(`  [${idx}] menu_item_id=${item.menu_item_id}, qty=${item.quantity}`);
      });

      // Fetch menu item details to get names for the new items
      const enrichedNewItems = [];
      for (const item of itemsToInsert) {
        const { data: menuItem } = await supabase
          .from('menu_items')
          .select('id, name')
          .eq('id', item.menu_item_id)
          .single();

        enrichedNewItems.push({
          menu_item_id: item.menu_item_id,
          name: menuItem?.name || item.menu_item_id,
          quantity: item.quantity,
          price: item.price
        });
      }

      // console.log('💾 enrichedNewItems count:', enrichedNewItems.length);
      enrichedNewItems.forEach((item, idx) => {
        // console.log(`  [${idx}] ${item.name} (x${item.quantity})`);
      });

      let userId = req.user.user_id || req.user.id;
      const userIdInt = typeof userId === 'string' && /^\d+$/.test(userId) ? parseInt(userId, 10) : userId;
      
      const kotData = {
        food_order_id: orderId,
        booking_id: order.booking_id,
        user_id: userIdInt,
        kot_type: 'additions',
        total_items: enrichedNewItems.length,
        total_amount: fullOrderTotal,
        amount_paid: currentAmountPaid,
        amount_due: finalAmountDue,
        items_snapshot: null,
        new_items_snapshot: enrichedNewItems,
        kot_date: new Date().toISOString()
      };

      const { data: kotEntry, error: kotError } = await supabase
        .from('food_order_history')
        .insert([kotData])
        .select();

      if (kotError) {
        console.error('Warning: Could not create KOT history entry for additions:', kotError);
        // Don't fail the update if KOT history fails
      } else {
        // console.log('✅ Additions KOT history created:', kotEntry?.[0]?.id);
        // console.log('   Items in this KOT:', enrichedNewItems.map(i => `${i.name} (x${i.quantity})`).join(', '));
      }
    }

    // console.log('💰 Order total updated:', { orderId, total_amount: totalAmount, amount_paid: currentAmountPaid, amount_due: finalAmountDue });

    // Get updated order with items (include voided columns)
    const { data: updatedItems } = await supabase
      .from('food_order_items')
      .select('id, menu_item_id, quantity, voided_quantity, voided_at, voided_reason, price')
      .eq('order_id', orderId);

    // console.log('\n' + '='.repeat(70));
    // console.log('📊 FINAL ORDER STATE AFTER UPDATE:');
    // console.log('='.repeat(70));
    // console.log('Order ID:', orderId);
    // console.log('Total Amount: ₹' + totalAmount.toFixed(2));
    // console.log('Amount Paid: ₹' + (amount_paid || 0).toFixed(2));
    // console.log('Amount Due: ₹' + finalAmountDue.toFixed(2));
    // console.log('Total Items in Order:', updatedItems?.length || 0);
    
    updatedItems?.forEach((item, idx) => {
      // console.log(`  ${idx + 1}. Item ID: ${item.id} | Menu Item: ${item.menu_item_id} | Qty: ${item.quantity} | Price: ₹${item.price}`);
    });
    
    // console.log('='.repeat(70) + '\n');

    res.json({ 
      message: 'Order updated', 
      order: { ...order, total_amount: fullOrderTotal, amount_paid: currentAmountPaid, amount_due: finalAmountDue }, 
      items: updatedItems,
      newItems: itemsToInsert,  // Return newly added items for KOT printing
      newItemsCount: itemsToInsert.length
    });
  } catch (err) {
    console.error('❌ Error in updateOrder:', err);
    res.status(500).json({ error: 'Failed to update order', details: err.message });
  }
};

// GET - Order details for modal display (when clicking Order Food button)
const getOrderDetails = async (req, res) => {
  try {
    const { booking_id } = req.params;

    // console.log('=== getOrderDetails called ===');
    // console.log('booking_id:', booking_id);

    if (!booking_id) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    const bookingId = parseInt(booking_id, 10);

    // Check if order exists for this booking
    const { data: order, error: orderError } = await supabase
      .from('food_orders')
      .select('*')
      .eq('booking_id', bookingId);

    if (orderError) {
      console.error('❌ Error fetching order:', orderError);
      return res.status(500).json({ error: 'Failed to fetch order', details: orderError.message });
    }

    if (!order || order.length === 0) {
      // console.log('ℹ️ No order found for booking:', bookingId);
      return res.json({ exists: false, order: null, items: [] });
    }

    const orderId = order[0].id;
    // console.log('✅ Order found:', orderId);

    // Get order items - all items, we'll calculate remaining quantity in UI
    const { data: items, error: itemsError } = await supabase
      .from('food_order_items')
      .select('*')
      .eq('order_id', orderId);

    if (itemsError) {
      console.error('❌ Error fetching items:', itemsError);
      return res.status(500).json({ error: 'Failed to fetch items' });
    }

    // Map items to include remaining_quantity for UI display
    // Include ALL items (even fully voided ones) so UI can display cancellation info
    const itemsWithRemaining = (items || []).map(item => ({
      ...item,
      remaining_quantity: (item.quantity || 0) - (item.voided_quantity || 0)
    }));

    // console.log('📦 Order has', itemsWithRemaining?.length || 0, 'items');
    res.json({ exists: true, order: order[0], items: itemsWithRemaining || [] });
  } catch (err) {
    console.error('❌ Error in getOrderDetails:', err);
    res.status(500).json({ error: 'Failed to get order details', details: err.message });
  }
};

// DELETE - Cancel entire order
const cancelOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    // console.log('=== cancelOrder called ===');
    // console.log('Cancelling order:', orderId);

    // Delete all items first
    const { error: deleteItemsError } = await supabase
      .from('food_order_items')
      .delete()
      .eq('order_id', orderId);

    if (deleteItemsError) {
      console.error('❌ Error deleting order items:', deleteItemsError);
    }

    // Update order status to cancelled
    const { data: cancelledOrder, error: updateError } = await supabase
      .from('food_orders')
      .update({ status: 'cancelled', total_amount: 0 })
      .eq('id', orderId)
      .select();

    if (updateError || !cancelledOrder || cancelledOrder.length === 0) {
      console.error('❌ Error updating order:', updateError);
      return res.status(500).json({ error: 'Failed to cancel order' });
    }

    // console.log('✅ Order cancelled:', cancelledOrder[0].id);
    res.json({ message: 'Order cancelled', order: cancelledOrder[0] });
  } catch (err) {
    console.error('❌ Error in cancelOrder:', err);
    res.status(500).json({ error: 'Failed to cancel order', details: err.message });
  }
};

// Check if order exists for a booking (without creating)
const checkOrderExists = async (req, res) => {
  try {
    const { booking_id } = req.params;
    
    // console.log('=== checkOrderExists called ===');
    // console.log('booking_id:', booking_id);

    if (!booking_id) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    const bookingId = parseInt(booking_id, 10);

    // Check if order exists for this booking
    const { data: existingOrders, error: checkError } = await supabase
      .from('food_orders')
      .select('*')
      .eq('booking_id', bookingId);

    if (checkError) {
      console.error('❌ Error checking order:', checkError);
      return res.status(500).json({ error: 'Failed to check order', details: checkError.message });
    }

    if (existingOrders && existingOrders.length > 0) {
      // console.log('✅ Order exists:', existingOrders[0].id);
      return res.json({ exists: true, order: existingOrders[0] });
    }

    // console.log('ℹ️ No existing order for booking:', bookingId);
    res.json({ exists: false, order: null });
  } catch (err) {
    console.error('❌ Error in checkOrderExists:', err);
    res.status(500).json({ error: 'Failed to check order', details: err.message });
  }
};

// PRINT KOT - Create a KOT snapshot and record in history
// Can be called for initial order or for new additions
const printKOT = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { newItems, kotType } = req.body; // newItems optional, kotType: 'initial' or 'additions'
    let userId = req.user.user_id || req.user.id;

    // console.log('=== printKOT called ===');
    // console.log('orderId:', orderId, 'kotType:', kotType, 'newItems:', newItems?.length);

    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Fetch current order
    const { data: order, error: orderError } = await supabase
      .from('food_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('Order not found:', orderError);
      return res.status(404).json({ error: 'Order not found' });
    }

    // Fetch current order items with proper data structure
    const { data: orderItems, error: itemsError } = await supabase
      .from('food_order_items')
      .select(`
        id,
        order_id,
        menu_item_id,
        quantity,
        price,
        menu_items (
          id,
          name,
          category,
          description
        )
      `)
      .eq('order_id', orderId);

    if (itemsError) {
      console.error('Error fetching items:', itemsError);
      return res.status(500).json({ error: 'Failed to fetch order items' });
    }

    // Enrich items with menu item names for snapshot storage
    const enrichedOrderItems = orderItems?.map(item => ({
      id: item.id,
      menu_item_id: item.menu_item_id,
      name: item.menu_items?.[0]?.name || item.menu_item_id,
      quantity: item.quantity,
      price: item.price,
      category: item.menu_items?.[0]?.category
    })) || [];

    // Enrich newItems with complete data if provided
    const enrichedNewItems = newItems?.map(item => ({
      menu_item_id: item.menu_item_id,
      name: item.name || item.menu_item_id,
      quantity: item.quantity,
      price: item.price
    })) || [];

    // NOTE: KOT history entry is already created in updateOrder() when items are added
    // DO NOT create another entry here to avoid duplicates
    // This function now only returns the KOT data for the print window
    
    const userIdInt = typeof userId === 'string' && /^\d+$/.test(userId) ? parseInt(userId, 10) : userId;
    
    // Just prepare the response without creating another KOT history entry
    const kotTypeValue = kotType === 'additions' ? 'additions' : 'initial';

    // Return KOT data for printing (but don't create a new history entry)
    res.json({
      message: 'KOT data retrieved for printing',
      order,
      items: kotTypeValue === 'additions' ? enrichedNewItems : enrichedOrderItems,
      kotType: kotTypeValue
    });
  } catch (err) {
    console.error('❌ Error in printKOT:', err);
    res.status(500).json({ error: 'Failed to print KOT', details: err.message });
  }
};

// GET KOT HISTORY - Get all KOT records for an order or booking
const getKOTHistory = async (req, res) => {
  try {
    const { booking_id } = req.params;

    // console.log('=== getKOTHistory called ===');
    // console.log('booking_id:', booking_id);

    if (!booking_id) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    const bookingId = parseInt(booking_id, 10);

    // First, fetch the order to get its creation date (for initial items)
    const { data: order, error: orderError } = await supabase
      .from('food_orders')
      .select('id, created_at')
      .eq('booking_id', bookingId)
      .single();

    // Fetch all KOT records for this booking, ordered by date (latest first)
    const { data: kotHistory, error: historyError } = await supabase
      .from('food_order_history')
      .select('*')
      .eq('booking_id', bookingId)
      .order('kot_date', { ascending: false });

    if (historyError) {
      console.error('Error fetching KOT history:', historyError);
      return res.status(500).json({ error: 'Failed to fetch KOT history', details: historyError.message });
    }

    // console.log(`📋 KOT history for booking ${bookingId}: Found ${kotHistory?.length || 0} records`);

    // Don't filter duplicates - show ALL KOT records
    const uniqueKOTs = kotHistory || [];

    // Helper function to convert UTC to IST string
    const convertToIST = (utcDate) => {
      if (!utcDate) return 'N/A';
      return new Date(utcDate).toLocaleString('en-IN', { 
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    };

    // Convert UTC times to IST format in the response
    const kotHistoryWithIST = uniqueKOTs.map(kot => ({
      ...kot,
      kot_date: convertToIST(kot.kot_date),
      order_created_date: order?.created_at ? convertToIST(order.created_at) : 'N/A'
    }));

    // Parse items snapshots to ensure item names are shown
    const processedHistory = kotHistoryWithIST.map(kot => {
      let items_snapshot = [];
      let new_items_snapshot = [];
      
      try {
        if (kot.items_snapshot) {
          items_snapshot = typeof kot.items_snapshot === 'string' ? JSON.parse(kot.items_snapshot) : kot.items_snapshot;
        }
        if (kot.new_items_snapshot) {
          new_items_snapshot = typeof kot.new_items_snapshot === 'string' ? JSON.parse(kot.new_items_snapshot) : kot.new_items_snapshot;
        }
      } catch (e) {
        console.error('Error parsing snapshots:', e);
      }

      return {
        ...kot,
        items_snapshot: items_snapshot,
        new_items_snapshot: new_items_snapshot
      };
    });

    // console.log('✅ KOT history retrieved:', processedHistory.length);

    res.json({
      history: processedHistory || []
    });
  } catch (err) {
    console.error('❌ Error in getKOTHistory:', err);
    res.status(500).json({ error: 'Failed to fetch KOT history', details: err.message });
  }
};

// CANCEL ITEM - Mark single item as voided instead of deleting
const cancelItem = async (req, res) => {
  try {
    const { orderId, itemId } = req.params;
    const { reason, quantity } = req.body;

    // console.log('🔴 cancelItem called');
    // console.log('   orderId:', orderId);
    // console.log('   itemId:', itemId);
    // console.log('   quantity:', quantity);

    if (!orderId || !itemId) {
      console.error('❌ Missing orderId or itemId');
      return res.status(400).json({ error: 'Order ID and Item ID are required' });
    }

    // Verify order exists
    const { data: order, error: orderError } = await supabase
      .from('food_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('Order not found:', orderError);
      return res.status(404).json({ error: 'Order not found' });
    }

    // Verify item exists and belongs to this order
    const { data: item, error: itemError } = await supabase
      .from('food_order_items')
      .select('*')
      .eq('id', itemId)
      .eq('order_id', orderId)
      .single();

    if (itemError || !item) {
      console.error('Item not found:', itemError);
      return res.status(404).json({ error: 'Item not found in this order' });
    }

    // Check if item is already fully voided
    const currentVoidedQty = item.voided_quantity || 0;
    const remainingQty = item.quantity - currentVoidedQty;

    // console.log('📊 Cancellation Details:');
    // console.log('   Original Qty:', item.quantity);
    // console.log('   Already Voided:', currentVoidedQty);
    // console.log('   Currently Available:', remainingQty);
    // console.log('   Requesting to Cancel:', quantity);

    // Determine quantity to void
    const quantityToVoid = quantity || remainingQty;

    // Validate quantity
    if (quantityToVoid <= 0 || quantityToVoid > remainingQty) {
      return res.status(400).json({ 
        error: `Invalid quantity. Available: ${remainingQty}, Requested to cancel: ${quantityToVoid}` 
      });
    }

    // Only update voided_quantity - don't touch quantity field
    const voidedAtTime = new Date().toISOString();
    const newVoidedQty = currentVoidedQty + quantityToVoid;
    
    // console.log('   New Voided Qty:', newVoidedQty, '(was', currentVoidedQty, 'adding', quantityToVoid, ')');
    
    const updateData = {
      voided_quantity: newVoidedQty, // Add to existing voided quantity
      voided_at: voidedAtTime,
      voided_reason: reason || 'Customer requested cancellation'
    };

    const { data: voidedItem, error: voidError } = await supabase
      .from('food_order_items')
      .update(updateData)
      .eq('id', itemId)
      .select();

    if (voidError || !voidedItem || voidedItem.length === 0) {
      console.error('❌ Error voiding item:', voidError);
      return res.status(500).json({ error: 'Failed to cancel item', details: voidError?.message });
    }

    // Calculate amount to subtract from order total (with 5% GST included)
    const baseAmountToSubtract = (item.price || 0) * quantityToVoid;
    const gstInclusiveAmountToSubtract = baseAmountToSubtract * 1.05;

    // Get current order total
    const currentTotal = order.total_amount || 0;
    const newTotalAmount = Math.max(0, currentTotal - gstInclusiveAmountToSubtract);

    // Calculate new amount due
    const newAmountDue = Math.max(0, newTotalAmount - (order.amount_paid || 0));

    // Update order totals
    const { data: updatedOrder, error: updateError } = await supabase
      .from('food_orders')
      .update({
        total_amount: newTotalAmount,
        amount_due: newAmountDue
      })
      .eq('id', orderId)
      .select();

    if (updateError) {
      console.error('❌ Error updating order totals:', updateError);
      return res.status(500).json({ error: 'Failed to update order totals', details: updateError.message });
    }

    // console.log('✅ Item cancelled:', itemId);
    // console.log('   Voided quantity:', quantityToVoid);
    // console.log('   Base amount: ₹' + baseAmountToSubtract.toFixed(2));
    // console.log('   Amount subtracted (with 5% GST): ₹' + gstInclusiveAmountToSubtract.toFixed(2));
    // console.log('   Previous total: ₹' + currentTotal.toFixed(2));
    // console.log('   New total: ₹' + newTotalAmount.toFixed(2));

    res.json({
      message: 'Item cancelled successfully',
      item: voidedItem[0],
      order: updatedOrder[0],
      quantityVoided: quantityToVoid,
      amountSubtracted: gstInclusiveAmountToSubtract,
      newTotalAmount: newTotalAmount,
      newAmountDue: newAmountDue
    });
  } catch (err) {
    console.error('❌ Error in cancelItem:', err);
    res.status(500).json({ error: 'Failed to cancel item', details: err.message });
  }
};

module.exports = {
  createOrder,
  updateOrder,
  getOrderDetails,
  cancelOrder,
  checkOrderExists,
  printKOT,
  getKOTHistory,
  cancelItem
};
