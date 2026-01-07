import { useState, useEffect, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { format } from 'date-fns';
import { Dialog, Transition } from '@headlessui/react';
import { toast } from 'react-hot-toast';
import RefundModal from '../components/Booking/RefundModal';
import FoodPaymentModal from '../components/FoodOrder/FoodPaymentModal';
import {
  RiAddLine,
  RiSearchLine,
  RiHistoryLine,
  RiEdit2Line,
  RiEyeLine,
  RiCloseLine,
  RiDownloadLine
} from 'react-icons/ri';

import './BookingManagement.css';
const BASE_URL = import.meta.env.VITE_API_URL;

const BookingManagement = () => {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  
  // New state for payment modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [paymentBooking, setPaymentBooking] = useState(null);
  const [selectedBookingForRefund, setSelectedBookingForRefund] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newAmount, setNewAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');

  // Food payment state
  const [showFoodPaymentModal, setShowFoodPaymentModal] = useState(false);
  const [selectedBookingForFoodPayment, setSelectedBookingForFoodPayment] = useState(null);
  const [foodPaymentAmount, setFoodPaymentAmount] = useState('');
  const [foodPaymentMode, setFoodPaymentMode] = useState('Cash');
  const [foodOrderData, setFoodOrderData] = useState(null);
  const [bookingFoodOrders, setBookingFoodOrders] = useState({});

  // Print format modal state
  const [showPrintFormatModal, setShowPrintFormatModal] = useState(false);
  const [selectedBookingIdForPrint, setSelectedBookingIdForPrint] = useState(null);

  const fetchBookings = async () => {
    try {
      setLoading(true);
      setError('');
      const token = localStorage.getItem('token');
      
      if (!token) {
        setError('Authentication required');
        return;
      }
      
      const { data } = await axios.get(`${BASE_URL}/api/bookings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      // console.log('Fetched bookings data:', data);
      if (Array.isArray(data)) {
        setBookings(data);
        
        // Check food orders for all bookings and store amount_due
        const foodOrdersMap = {};
        await Promise.all(data.map(async (booking) => {
          try {
            const orderRes = await axios.get(
              `${BASE_URL}/api/food-orders/booking/${booking.booking_id}/details`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (orderRes.data?.order) {
              foodOrdersMap[booking.booking_id] = {
                exists: true,
                amount_due: orderRes.data.order.amount_due || 0,
                has_pending_payment: (orderRes.data.order.amount_due || 0) > 0
              };
            } else {
              foodOrdersMap[booking.booking_id] = { exists: false, amount_due: 0, has_pending_payment: false };
            }
          } catch (err) {
            // No order exists
            foodOrdersMap[booking.booking_id] = { exists: false, amount_due: 0, has_pending_payment: false };
          }
        }));
        setBookingFoodOrders(foodOrdersMap);
        
        // Debug: Log all booking statuses
        // console.log('🔍 Booking Statuses:');
        data.forEach((b, idx) => {
          // console.log(`  ${idx + 1}. Booking ${b.booking_id}: status="${b.status}" | toLowerCase="${b.status?.toLowerCase()}"`);
        });
        
        if (data.length === 0) {
          setError('No bookings found. Create a new booking to get started.');
        }
        
        // Notify room management to refresh
        window.dispatchEvent(new CustomEvent('roomStatusChanged'));
      } else {
        console.error('Unexpected response format:', response.data);
        setError('Received invalid data from server');
      }
    } catch (err) {
      console.error('Booking fetch error:', err);
      setError(err.response?.data?.message || 'Failed to fetch bookings');
      setBookings([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, []);

  // Filter and sort bookings
  const filteredBookings = bookings
    .filter(booking => {
      // Apply status filter
      if (filter !== 'all') {
        const bookingStatus = (booking.status || '').toLowerCase();
        const filterStatus = filter.toLowerCase();
        console.log('Comparing status:', { bookingStatus, filterStatus });
        return bookingStatus === filterStatus;
      }
      return true;
    })
    .filter(booking => {
      // Apply search filter
      if (!searchQuery) return true;
      
      const searchLower = searchQuery.toLowerCase();
      return (
        (booking?.customer?.name || '').toLowerCase().includes(searchLower) ||
        (booking?.customer?.phone || '').includes(searchQuery) ||
        (booking?.primary_guest?.name || '').toLowerCase().includes(searchLower) ||
        (booking?.primary_guest?.phone || '').includes(searchQuery) ||
        (booking?.booking_id?.toString() || '').includes(searchQuery) ||
        (booking?.rooms?.[0]?.room_number?.toString() || '').includes(searchQuery)
      );
    })
    .sort((a, b) => {
      // Apply sorting by date
      const dateA = new Date(a.checkin_date);
      const dateB = new Date(b.checkin_date);
      
      return sortOrder === 'desc'
        ? dateB - dateA
        : dateA - dateB;
    });

  // Calculate nights between dates
  const calculateNights = (checkin, checkout) => {
    return Math.ceil((new Date(checkout) - new Date(checkin)) / (1000 * 60 * 60 * 24));
  };

  // Get status color class
  const getStatusColor = (status) => {
    switch (status.toLowerCase()) {
      case 'checked-in': return 'status-green';
      case 'cancelled': return 'status-red';
      case 'checked-out': return 'status-blue';
      case 'upcoming': return 'status-yellow';
      default: return '';
    }
  };

  //Handle booking operations
  const handleViewDetails = (booking) => {
    setSelectedBooking(booking);
    setShowDetailModal(true);
  };

  const handleEditBooking = (bookingId) => {
    navigate(`/booking/edit/${bookingId}`);
  };

  // Function to handle opening the payment modal
  const handleOpenPaymentModal = (booking) => {
    setPaymentBooking(booking);
    setNewAmount('');
    setPaymentMode('CASH');
    setShowPaymentModal(true);
  };

  // Function to handle payment submission
  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    
    if (!newAmount || parseFloat(newAmount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    const amountToAdd = parseFloat(newAmount);
    if (amountToAdd > (paymentBooking.amount_due || paymentBooking.total_amount - (paymentBooking.amount_paid || 0))) {
      toast.error('Payment amount cannot exceed the amount due');
      return;
    }

    // Format payment mode to match database constraint ('Cash', 'Card', etc.)
    const formattedPaymentMode = paymentMode === 'UPI' ? 'UPI' : 
      paymentMode === 'Bank Transfer' ? 'Bank Transfer' : 
      paymentMode.charAt(0).toUpperCase() + paymentMode.slice(1).toLowerCase();

    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      await axios.post(
        `${BASE_URL}/api/bookings/${paymentBooking.booking_id}/payment`,
        {
          amount_paid: amountToAdd,
          payment_mode: formattedPaymentMode
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      toast.success('Payment added successfully');
      setShowPaymentModal(false);
      setPaymentBooking(null);
      await fetchBookings(); // Refresh the bookings list
    } catch (err) {
      console.error('Payment error:', err);
      toast.error(err.response?.data?.message || 'Failed to add payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePayment = async (bookingId, newStatus) => {
    try {
      const token = localStorage.getItem('token');
      // Convert payment status to uppercase
      const uppercaseStatus = newStatus.toUpperCase();
      await axios.put(
        `${BASE_URL}/api/bookings/${bookingId}/payment`,
        { payment_status: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      // Refresh bookings list
      await fetchBookings();
      
      // Show success message
      toast.success(`Payment status updated to ${newStatus}`);
    } catch (err) {
      console.error('Payment update error:', err);
      toast.error(err.response?.data?.message || 'Failed to update payment status');
    }
  };

  const handleCheckin = async (bookingId) => {
    if (!window.confirm('Are you sure you want to check in this booking?')) {
      return;
    }

    try {
      setError('');
      const token = localStorage.getItem('token');
      
      await axios.put(
        `${BASE_URL}/api/bookings/${bookingId}/checkin`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Broadcast event to refresh room status
      window.dispatchEvent(new CustomEvent('roomStatusChanged'));

      // Refresh bookings list
      await fetchBookings();
      alert('Check-in successful!');
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to check in booking';
      setError(errorMsg);
      alert(errorMsg);
    }
  };

  const handleCheckout = async (bookingId) => {
    if (!window.confirm('Are you sure you want to check out this booking?')) {
      return;
    }

    try {
      setError('');
      const token = localStorage.getItem('token');
      
      await axios.put(
        `${BASE_URL}/api/bookings/${bookingId}/checkout`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Broadcast an event to notify RoomManagement to refresh
      window.dispatchEvent(new CustomEvent('roomStatusChanged'));
      
      // Refresh bookings list
      await fetchBookings();
      alert('Checkout successful!');
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.response?.data?.error || 'Failed to checkout booking';
      setError(errorMsg);
      alert(errorMsg);
    }
  };

  const handleDeleteBooking = async (bookingId) => {
    if (!window.confirm('Are you sure you want to delete this booking? This action cannot be undone.')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${BASE_URL}/api/bookings/${bookingId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      // Refresh bookings list
      await fetchBookings();
      
      // Broadcast event to refresh room status
      window.dispatchEvent(new CustomEvent('roomStatusChanged'));
      
      alert('Booking deleted successfully');
    } catch (err) {
      console.error('Delete booking error:', err);
      alert(err.response?.data?.message || 'Failed to delete booking');
    }
  };

  const handleCancelBooking = (booking) => {
    setSelectedBookingForRefund(booking);
    setShowRefundModal(true);
  };

  const handleViewInvoice = (bookingId) => {
    setSelectedBookingIdForPrint(bookingId);
    setShowPrintFormatModal(true);
  };

  const handlePrintFormatSelected = async (format) => {
    setShowPrintFormatModal(false);
    
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      if (format === 'thermal') {
        // For thermal: Get invoice + food data and display as HTML
        const response = await axios({
          url: `${BASE_URL}/api/bookings/${selectedBookingIdForPrint}/invoice/print-data`,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        const { invoiceData, foodBillData } = response.data;
        console.log('API Response - invoiceData:', invoiceData);
        console.log('API Response - foodBillData:', foodBillData);
        console.log('Booking object:', invoiceData.booking);
        console.log('Checkin Time (raw):', invoiceData.booking?.checkin_time);
        console.log('Checkout Time (raw):', invoiceData.booking?.checkout_time);
        displayThermalInvoice(invoiceData, foodBillData);
      } else {
        // For A4: Get PDF and display
        const response = await axios({
          url: `${BASE_URL}/api/bookings/${selectedBookingIdForPrint}/invoice/download`,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/pdf'
          },
          responseType: 'blob'
        });

        if (!response.data || response.data.size === 0) {
          throw new Error('Received empty PDF data');
        }

        const blob = new Blob([response.data], { type: 'application/pdf' });
        const blobUrl = window.URL.createObjectURL(blob);
        
        const newWindow = window.open();
        if (newWindow) {
          newWindow.document.write(
            '<html><head><title>Invoice Preview</title></head><body style="margin:0;padding:0;">' +
            '<embed width="100%" height="100%" src="' + blobUrl + '" type="application/pdf">' +
            '</body></html>'
          );
        } else {
          const iframe = document.createElement('iframe');
          iframe.style.width = '100%';
          iframe.style.height = '100%';
          iframe.style.position = 'fixed';
          iframe.style.top = '0';
          iframe.style.left = '0';
          iframe.style.zIndex = '9999';
          iframe.src = blobUrl;
          
          const container = document.createElement('div');
          container.style.position = 'fixed';
          container.style.width = '100%';
          container.style.height = '100%';
          container.style.top = '0';
          container.style.left = '0';
          container.style.background = 'rgba(0,0,0,0.8)';
          container.style.zIndex = '9998';
          
          const closeButton = document.createElement('button');
          closeButton.innerText = 'Close';
          closeButton.style.position = 'fixed';
          closeButton.style.top = '20px';
          closeButton.style.right = '20px';
          closeButton.style.zIndex = '10000';
          closeButton.onclick = () => {
            document.body.removeChild(container);
            document.body.removeChild(closeButton);
            window.URL.revokeObjectURL(blobUrl);
          };
          
          document.body.appendChild(container);
          document.body.appendChild(closeButton);
          container.appendChild(iframe);
        }
      }

    } catch (err) {
      console.error('Detailed error:', err);
      let errorMessage = 'Failed to fetch invoice.';
      
      if (err.response) {
        // console.log('Error response:', {
        //   status: err.response.status,
        //   data: err.response.data,
        //   headers: err.response.headers
        // });
        
        if (err.response.status === 401) {
          errorMessage = 'Session expired. Please login again.';
          navigate('/login');
        } else if (err.response.status === 400) {
          errorMessage = err.response.data?.error || 'Cannot generate invoice. Make sure payment is completed.';
        } else if (err.response.status === 404) {
          errorMessage = 'Invoice not found. Please make sure the booking exists.';
        } else if (err.response.status === 500) {
          errorMessage = 'Server error while generating invoice. Please try again.';
        }
      }
      
      alert(errorMessage);
    }
    setSelectedBookingIdForPrint(null);
  };

  const displayThermalInvoice = (invoiceData, foodBillData) => {
    const hotel = invoiceData.hotel || {};
    const booking = invoiceData.booking || {};
    const customer = invoiceData.customer || {};
    const guests = invoiceData.guests || {};
    const bookingId = invoiceData.booking_id;
    const createdAt = invoiceData.created_at;
    const invoiceDate = invoiceData.invoice_date;

    // Get guest name and customer details - SAME as PDF
    const guestName = guests.primary?.name || customer.name || 'Guest';
    const guestPhone = guests.primary?.phone || customer.phone || '';
    const guestAddress = customer.address || {};

    // Calculate pax (primary + additional guests)
    const pax = 1 + (guests.additional?.length || 0);

    // Format dates and times
    const formatDateIST = (dateStr) => {
      if (!dateStr) return 'N/A';
      return new Date(dateStr).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    };

    const formatTimeIST = (timeStr) => {
      if (!timeStr) return 'N/A';
      
      // Case 1: Already formatted as "HH:MM:SS" (backend already converted)
      if (typeof timeStr === 'string' && timeStr.match(/^\d{2}:\d{2}:\d{2}$/)) {
        // Convert 24h to 12h format
        const [hours, minutes] = timeStr.split(':');
        const h = parseInt(hours);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${String(h12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${ampm}`;
      }
      
      // Case 2: If it contains "IST", extract and convert time part
      if (typeof timeStr === 'string' && timeStr.includes('IST')) {
        const timePart = timeStr.split(' ')[0];
        const [hours, minutes] = timePart.split(':');
        const h = parseInt(hours);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${String(h12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${ampm}`;
      }
      
      // Case 3: If it's a date string (UTC), convert to IST
      if (typeof timeStr === 'string') {
        try {
          let isoString = timeStr;
          
          // Handle format "2026-01-04 12:46:08.88" (space instead of T)
          if (isoString.includes(' ') && !isoString.includes('T')) {
            isoString = isoString.replace(' ', 'T');
          }
          
          // Add Z if not present (mark as UTC)
          if (!isoString.endsWith('Z') && !isoString.includes('+')) {
            isoString = isoString + 'Z';
          }
          
          const dateObj = new Date(isoString);
          if (isNaN(dateObj.getTime())) return timeStr || 'N/A';
          
          // Convert UTC to IST (+5:30 hours)
          const istDate = new Date(dateObj.getTime() + (5.5 * 60 * 60 * 1000));
          
          // Format as HH:MM:SS in 12h format
          const hours = istDate.getUTCHours();
          const minutes = String(istDate.getUTCMinutes()).padStart(2, '0');
          const ampm = hours >= 12 ? 'PM' : 'AM';
          const h12 = hours % 12 || 12;
          
          return `${String(h12).padStart(2, '0')}:${minutes} ${ampm}`;
        } catch (e) {
          console.error('Time format error:', e, timeStr);
          return timeStr || 'N/A';
        }
      }
      
      return timeStr || 'N/A';
    };

    // Format departure date using same logic as backend
    const getFormattedDepartureDate = (checkoutDate) => {
      if (!checkoutDate) return 'N/A';
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Reset time to start of day
        
        const checkout = new Date(checkoutDate);
        checkout.setHours(0, 0, 0, 0); // Reset time to start of day
        
        // If checkout date is today or earlier, show checkout date
        // If checkout date is later, show today
        const departureDate = checkout <= today ? checkout : today;
        
        return departureDate.toLocaleDateString('en-IN', {
          year: 'numeric',
          month: 'long',
          day: '2-digit'
        });
      } catch (e) {
        return checkoutDate || 'N/A';
      }
    };

    // Calculate room GST (5% = 2.5% SGST + 2.5% CGST) - SAME as PDF
    const roomTotal = parseFloat(booking.total_amount || 0);
    const roomSubtotal = roomTotal / 1.05;
    const roomSgst = (roomSubtotal * 0.025);
    const roomCgst = (roomSubtotal * 0.025);

    // Hotel logo
    const hotelLogo = hotel.hotel_logo_url || '';

    let thermalHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Thermal Invoice</title>
        <meta charset="UTF-8">
        <style>
          @media print {
            html { margin: 0; padding: 0; }
            @page { 
              margin: 0mm !important; 
              size: 80mm auto !important;
            }
            * { 
              margin: 0 !important;
              padding: 0 !important;
            }
            body { 
              margin: 0 !important;
              padding: 4mm 3mm !important;
              width: 74mm !important;
              height: auto !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              color-adjust: exact !important;
            }
            .print-btn { display: none !important; }
            table { page-break-inside: avoid; }
          }
          
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html { 
            width: 80mm;
            margin: 0;
            padding: 0;
          }
          body {
            font-family: Arial, 'Courier New', Courier, monospace;
            width: 74mm;
            margin: 0 auto;
            padding: 4mm 3mm;
            font-size: 11px;
            line-height: 1.5;
            color: #000;
            background: white;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            color-adjust: exact;
            overflow-x: hidden;
            height: auto;
          }
          
          .print-btn {
            background: #007bff;
            color: white;
            border: none;
            padding: 10px 16px;
            font-size: 13px;
            cursor: pointer;
            border-radius: 4px;
            margin-bottom: 10px;
            font-weight: bold;
            width: 100%;
          }
          .print-btn:hover { background: #0056b3; }
          
          .header-row {
            display: flex;
            flex-direction: row;
            align-items: flex-start;
            gap: 8px;
            margin-bottom: 8px;
            width: 100%;
            overflow: hidden;
          }
          .logo-section {
            flex-shrink: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            width: 65px;
            height: 65px;
          }
          .logo-section img {
            max-width: 65px;
            max-height: 60px;
            width: auto;
            height: auto;
            display: block;
            border: 1px solid #000;
            padding: 2px;
          }
          .header-content {
            flex: 1;
            text-align: center;
            min-width: 0;
            overflow: hidden;
          }
          
          .invoice-title { font-weight: bold; font-size: 12px; margin-bottom: 2px; color: #000; }
          .hotel-name { font-weight: bold; font-size: 12px; margin: 2px 0; color: #000; word-wrap: break-word; overflow-wrap: break-word; }
          .hotel-info { font-size: 10px; margin: 1px 0; line-height: 1.2; color: #000; word-wrap: break-word; overflow-wrap: break-word; }
          
          .header-bottom {
            border-bottom: 2px solid #000;
            padding-bottom: 4px;
            margin-bottom: 5px;
          }
          
          .section-title { 
            font-weight: bold; 
            font-size: 11px; 
            margin: 5px 0 3px 0; 
            color: #000;
            border-bottom: 1px solid #000;
            padding-bottom: 2px;
          }
          
          .divider { border-bottom: 1px solid #000; margin: 4px 0; }
          
          .info-row { 
            display: flex; 
            justify-content: space-between; 
            font-size: 10px; 
            margin: 2px 0; 
            color: #000;
            overflow: hidden;
            width: 100%;
            line-height: 1.3;
          }
          .info-label { 
            flex: 0 0 auto; 
            font-weight: bold; 
            color: #000;
            margin-right: 4px;
            word-wrap: break-word;
          }
          .info-value { 
            flex: 1; 
            text-align: right; 
            color: #000;
            word-wrap: break-word;
            overflow-wrap: break-word;
            min-width: 0;
          }
          
          table { 
            width: 100%; 
            border-collapse: collapse; 
            font-size: 10px; 
            margin: 4px 0;
            table-layout: auto;
            overflow: hidden;
          }
          th, td { 
            text-align: left; 
            padding: 2px 1px; 
            color: #000;
            word-wrap: break-word;
            overflow-wrap: break-word;
            max-width: 100%;
          }
          th { 
            font-weight: bold; 
            border-bottom: 1px solid #000; 
            color: #000;
            padding-bottom: 2px;
            padding-top: 2px;
            font-size: 10px;
          }
          td { 
            border-bottom: 1px solid #000; 
            color: #000;
          }
          
          .col-right { text-align: right; }
          
          .total-row { 
            display: flex; 
            justify-content: space-between; 
            font-weight: bold; 
            font-size: 12px; 
            padding: 3px 0;
            border-top: 1px solid #000;
            border-bottom: 1px solid #000;
            margin: 4px 0;
            color: #000;
            width: 100%;
            overflow: hidden;
          }
          .total-amt { 
            font-size: 12px; 
            font-weight: bold; 
            color: #000;
          }
          
          .page-break { 
            page-break-after: always; 
            margin: 10px 0; 
            border-top: 2px solid #000; 
            padding-top: 5px;
          }
          
          .footer { 
            text-align: center; 
            font-size: 9px; 
            margin-top: 5px; 
            padding-top: 3px; 
            border-top: 1px solid #000; 
            color: #000;
            line-height: 1.3;
          }
          
          .note { 
            font-size: 9px; 
            margin: 2px 0; 
            line-height: 1.2; 
            color: #000;
          }
        </style>
      </head>
      <body>
        <button class="print-btn" onclick="window.print()">🖨️ PRINT INVOICE</button>

        <div class="header-row">
          ${hotelLogo ? `<div class="logo-section"><img src="${hotelLogo}" alt="Hotel Logo" onerror="this.style.display='none'"></div>` : ''}
          <div class="header-content">
            <div class="invoice-title">INVOICE</div>
            <div class="hotel-name">${hotel.hotel_name || 'HOTEL'}</div>
            ${hotel.address_line1 ? `<div class="hotel-info">${hotel.address_line1}</div>` : ''}
            ${hotel.city ? `<div class="hotel-info">${hotel.city}${hotel.state ? ', ' + hotel.state : ''}</div>` : ''}
            ${hotel.country && hotel.pin_code ? `<div class="hotel-info">${hotel.country} - ${hotel.pin_code}</div>` : ''}
            ${hotel.gst_number ? `<div class="hotel-info">GSTIN: ${hotel.gst_number}</div>` : ''}
          </div>
        </div>
        <div class="header-bottom"></div>

        <div class="section-title">INVOICE DETAILS:</div>
        <div class="info-row"><span class="info-label">Inv No:</span><span class="info-value">INV-${bookingId}</span></div>
        <div class="info-row"><span class="info-label">Booking ID:</span><span class="info-value">${bookingId}</span></div>
        <div class="info-row"><span class="info-label">Date:</span><span class="info-value">${invoiceDate || 'N/A'}</span></div>
        <div class="divider"></div>

        <div class="section-title">GUEST DETAILS:</div>
        <div class="info-row"><span class="info-label">Name:</span><span class="info-value">${guestName}</span></div>
        ${guestAddress.address_line1 ? `<div class="info-row"><span class="info-label">Address:</span><span class="info-value">${guestAddress.address_line1}</span></div>` : ''}
        ${guestAddress.city ? `<div class="info-row"><span class="info-label">City:</span><span class="info-value">${guestAddress.city}${guestAddress.state ? ', ' + guestAddress.state : ''}</span></div>` : ''}
        ${customer.meal_plan ? `<div class="info-row"><span class="info-label">Meal Plan:</span><span class="info-value">${customer.meal_plan}</span></div>` : ''}
        ${customer.gst_number ? `<div class="info-row"><span class="info-label">GST No:</span><span class="info-value">${customer.gst_number}</span></div>` : ''}
        <div class="divider"></div>

        <div class="section-title">STAY DETAILS:</div>
        <div class="info-row"><span class="info-label">Check-In Date:</span><span class="info-value">${formatDateIST(booking.check_in_date)}</span></div>
        <div class="info-row"><span class="info-label">Check-In Time:</span><span class="info-value">${formatTimeIST(booking.checkin_time)}</span></div>
        <div class="info-row"><span class="info-label">Check-Out Date:</span><span class="info-value">${getFormattedDepartureDate(booking.check_out_date)}</span></div>
        <div class="info-row"><span class="info-label">Check-Out Time:</span><span class="info-value">${formatTimeIST(booking.checkout_time)}</span></div>
        <div class="info-row"><span class="info-label">Number of Nights:</span><span class="info-value">${booking.total_nights || 'N/A'}</span></div>
        <div class="info-row"><span class="info-label">Number of Guests:</span><span class="info-value">${pax}</span></div>
        <div class="divider"></div>

        <div class="section-title">ROOM CHARGES:</div>

        <table style="font-size: 10px;">
          <thead>
            <tr>
              <th style="width:28%">Room Type</th>
              <th style="width:12%">No</th>
              <th style="width:12%">Nts</th>
              <th class="col-right" style="width:24%">Rate</th>
              <th class="col-right" style="width:24%">Amt</th>
            </tr>
          </thead>
          <tbody>
    `;

    // Room details - SAME as PDF (with nightly rates if applicable)
    if (booking.rooms && booking.rooms.length > 0) {
      booking.rooms.forEach(room => {
        if (room.has_nightly_rates && room.nightly_rates && room.nightly_rates.length > 0) {
          // Show nightly breakdown - EXACTLY like PDF
          room.nightly_rates.forEach((nr, idx) => {
            thermalHtml += `<tr>
              ${idx === 0 ? `<td><strong>${room.room_type}</strong></td>` : `<td></td>`}
              ${idx === 0 ? `<td>${room.room_number}</td>` : `<td></td>`}
              <td>N${nr.night}</td>
              <td class="col-right">₹${nr.rate.toFixed(0)}</td>
              <td class="col-right">₹${nr.rate.toFixed(0)}</td>
            </tr>`;
          });
        } else {
          // Single rate for all nights - EXACTLY like PDF
          const roomAmount = room.total_nights * room.price_per_night;
          thermalHtml += `<tr>
            <td>${room.room_type}</td>
            <td>${room.room_number}</td>
            <td>${room.total_nights}N</td>
            <td class="col-right">₹${room.price_per_night.toFixed(0)}</td>
            <td class="col-right">₹${roomAmount.toFixed(2)}</td>
          </tr>`;
        }
      });
    }

    thermalHtml += `
        </tbody>
      </table>

      <div class="divider"></div>

      <table style="margin-bottom: 3px; font-size: 10px;">
        <tr><td style="width:50%">Subtotal:</td><td class="col-right" style="width:50%">₹${roomSubtotal.toFixed(2)}</td></tr>
        <tr><td>CGST (2.5%):</td><td class="col-right">₹${roomCgst.toFixed(2)}</td></tr>
        <tr><td>SGST (2.5%):</td><td class="col-right">₹${roomSgst.toFixed(2)}</td></tr>
      </table>

      <div class="total-row">
        <span>TOTAL ROOM:</span>
        <span class="total-amt">₹${roomTotal.toFixed(2)}</span>
      </div>

      <div class="divider"></div>

      <table style="font-size: 11px;">
        <tr><td style="width:50%"><strong>Amount Paid:</strong></td><td class="col-right" style="width:50%; font-weight: bold;">₹${(booking.amount_paid || 0).toFixed(2)}</td></tr>
        <tr><td><strong>Status:</strong></td><td class="col-right" style="font-weight: bold;">${booking.payment_status}</td></tr>
      </table>
    `;

    // Food Bill if exists
    if (foodBillData && foodBillData.foodOrder && foodBillData.foodItems && foodBillData.foodItems.length > 0) {
      const foodTotal = parseFloat(foodBillData.foodOrder.total_amount || 0);
      // Food bill has 5% GST = 2.5% CGST + 2.5% SGST
      const foodSubtotal = foodTotal / 1.05;
      const foodCgst = (foodSubtotal * 0.025);
      const foodSgst = (foodSubtotal * 0.025);

      thermalHtml += `
        <div class="page-break"></div>
        <div class="section-title">FOOD BILL</div>
        <div class="info-row"><span class="info-label">Order ID:</span><span class="info-value">${foodBillData.foodOrder.id}</span></div>
        <div class="info-row"><span class="info-label">Order Date:</span><span class="info-value">${new Date(foodBillData.foodOrder.created_at).toLocaleDateString('en-IN')}</span></div>
        <div class="info-row"><span class="info-label">Guest Name:</span><span class="info-value">${guestName}</span></div>

        <div class="divider"></div>

        <table style="font-size:10px;">
          <thead>
            <tr>
              <th style="width:32%;text-align:left">Item</th>
              <th class="col-right" style="width:22%">Price</th>
              <th class="col-right" style="width:15%">Qty</th>
              <th class="col-right" style="width:31%">Amt</th>
            </tr>
          </thead>
          <tbody>
      `;

      // Show food items with voided quantity handling (just like backend)
      foodBillData.foodItems.forEach(item => {
        const actualQty = item.quantity - (item.voided_quantity || 0); // Show only non-voided quantity
        if (actualQty > 0) { // Only show items with remaining quantity
          const itemTotal = actualQty * item.price;
          // Shorten item name if too long - limit to 18 chars
          const itemName = item.name.length > 18 ? item.name.substring(0, 15) + '..' : item.name;
          thermalHtml += `<tr>
            <td>${itemName}</td>
            <td class="col-right">₹${item.price.toFixed(0)}</td>
            <td class="col-right">${actualQty}</td>
            <td class="col-right">₹${itemTotal.toFixed(2)}</td>
          </tr>`;
        }
      });

      thermalHtml += `
          </tbody>
        </table>

        <div class="divider"></div>

        <table style="margin-bottom: 3px; font-size: 10px;">
          <tr><td style="width:50%">Subtotal:</td><td class="col-right" style="width:50%">₹${foodSubtotal.toFixed(2)}</td></tr>
          <tr><td>CGST (2.5%):</td><td class="col-right">₹${foodCgst.toFixed(2)}</td></tr>
          <tr><td>SGST (2.5%):</td><td class="col-right">₹${foodSgst.toFixed(2)}</td></tr>
        </table>

        <div class="total-row" style="font-size:11px;">
          <span>TOTAL FOOD:</span>
          <span class="total-amt">₹${foodTotal.toFixed(2)}</span>
        </div>

        <div class="divider"></div>

        <table style="font-size: 11px;">
          <tr><td style="width:50%"><strong>Amount Paid:</strong></td><td class="col-right" style="width:50%; font-weight: bold;">₹${(foodBillData.foodOrder.amount_paid || 0).toFixed(2)}</td></tr>
          <tr><td><strong>Status:</strong></td><td class="col-right" style="font-weight: bold;">${foodBillData.foodOrder.payment_status || 'N/A'}</td></tr>
        </table>

        <div class="divider"></div>
        <div class="total-row" style="font-size:12px;">
          <span>GRAND TOTAL:</span>
          <span class="total-amt">₹${(roomTotal + foodTotal).toFixed(2)}</span>
        </div>

        <div class="note">
          <p>Check-out: 12:00 PM</p>
          <p>Late checkout may incur charges</p>
        </div>
      `;
    }

    thermalHtml += `
      <div class="footer">
        
        Thank you for your visit!
        Please retain this invoice for your records.
        
      </div>
      </body>
      </html>
    `;

    // Open print window - same approach as KOT
    const printWindow = window.open('', '_blank', 'width=400,height=800');
    if (printWindow) {
      printWindow.document.write(thermalHtml);
      printWindow.document.close();
    } else {
      alert('Please allow popups to print invoice');
    }
  };

  // Food Order functions
  const checkExistingOrder = async (bookingId) => {
    setCheckingOrder(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(
        `${BASE_URL}/api/food-orders/check/${bookingId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      console.log('Order Check Result:', response.data);
      setExistingOrder(response.data?.order || null);
    } catch (err) {
      console.error('Error checking order:', err);
      setExistingOrder(null);
    } finally {
      setCheckingOrder(false);
    }
  };

  const handleOpenFoodModal = async (booking) => {
    try {
      // Check if booking status is "checkin"
      // console.log('🍽️  Food Order - Checking booking status:', booking.status);
      const validStatuses = ['checkin', 'checked-in', 'checked in'];
      
      if (!validStatuses.includes(booking.status?.toLowerCase())) {
        console.warn('⚠️  Cannot order food - booking status is:', booking.status);
        toast.error(`Food orders only available for checked-in bookings. Current status: ${booking.status}`);
        return;
      }

      // console.log('✅ Booking status is "checked-in" - navigating to food order page');
      // Navigate to the food order page
      navigate(`/booking/${booking.booking_id}/order-food`);
    } catch (err) {
      console.error('Error navigating to food order page:', err);
      toast.error('Failed to open food order page');
    }
  };

  // Handle Food Payment
  const handleOpenFoodPaymentModal = async (booking) => {
    try {
      // Check booking status first
      const validStatuses = ['checkin', 'checked-in', 'checked in'];
      if (!validStatuses.includes(booking.status?.toLowerCase())) {
        toast.error(`Cannot process food payment. Booking status is: ${booking.status}`);
        return;
      }

      const token = localStorage.getItem('token');
      
      // Fetch food order details
      const orderRes = await axios.get(
        `${BASE_URL}/api/food-orders/booking/${booking.booking_id}/details`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (orderRes.data?.order) {
        setFoodOrderData(orderRes.data.order);
        setSelectedBookingForFoodPayment(booking);
        setFoodPaymentAmount('');
        setFoodPaymentMode('Cash');
        setShowFoodPaymentModal(true);
      } else {
        toast.error('No food order found for this booking');
      }
    } catch (err) {
      console.error('Error fetching food order:', err);
      toast.error('Failed to load food order details');
    }
  };

  const handleFoodPaymentSubmit = async () => {
    if (!foodPaymentAmount || parseFloat(foodPaymentAmount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    const amountDue = foodOrderData.amount_due || 0;
    if (parseFloat(foodPaymentAmount) > amountDue) {
      toast.error('Payment amount cannot exceed due amount');
      return;
    }

    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const amount = parseFloat(foodPaymentAmount);

      // Record food payment using new API
      const paymentRes = await axios.post(
        `${BASE_URL}/api/food-payments/record`,
        {
          food_order_id: foodOrderData.id,
          amount,
          payment_mode: foodPaymentMode,
          notes: `Payment recorded for Booking #${selectedBookingForFoodPayment.booking_id}`
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // console.log('🎉 Food payment recorded:', paymentRes.data);
      toast.success(`Food payment of ₹${amount.toFixed(2)} recorded successfully`);
      
      setShowFoodPaymentModal(false);
      setFoodPaymentAmount('');
      fetchBookings();
    } catch (err) {
      console.error('Error processing food payment:', err);
      toast.error(err.response?.data?.message || 'Failed to process food payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  
  return (
    <div className="booking-management">
      {/* Header Section */}
      {/* <div className="header">
        <h1>Booking Management</h1>

      </div> */}
      <div>
    
      </div>

      {/* Actions Section - Single Row */}
      <div className="actions-section">
        <button 
          className="add-booking-btn"
          onClick={() => navigate('/bookings/new')}
        >
          <RiAddLine /> Add Booking
        </button>
        <button 
          className="view-history-btn"
          onClick={() => setFilter('checked-out')}
        >
          <RiHistoryLine /> View History
        </button>
        
        <div className="search-section">
          <div className="search-bar">
            <RiSearchLine />
            <input
              type="text"
              placeholder="Search by name, phone or booking ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Filters Section */}
      <div className="filters-section">
        <div className="status-tabs">
          <button 
            className={filter === 'all' ? 'active' : ''}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button 
            className={filter === 'checked-in' ? 'active' : ''}
            onClick={() => setFilter('checked-in')}
          >
            Current
          </button>
          <button 
            className={filter === 'upcoming' ? 'active' : ''}
            onClick={() => setFilter('upcoming')}
          >
            Upcoming
          </button>
          <button 
            className={filter === 'checked-out' ? 'active' : ''}
            onClick={() => setFilter('checked-out')}
          >
            Past
          </button>
          <button 
            className={filter === 'cancelled' ? 'active' : ''}
            onClick={() => setFilter('cancelled')}
          >
            Cancelled
          </button>
        </div>

        <div className="sort-options">
          <span className="sort-label">Sort by Check-In Date:</span>
          <button onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')} className="sort-btn">
            {sortOrder === 'desc' ? '↓ Newest First' : '↑ Oldest First'}
          </button>
        </div>
      </div>

      {/* Bookings Table */}
      {loading ? (
        <div className="loading">Loading bookings...</div>
      ) : error ? (
        <div className="error-message">{error}</div>
      ) : (
        <div className="bookings-table-container">
          <table className="bookings-table">
            <thead>
              <tr>
                <th>Booking ID</th>
                <th>Customer</th>
                <th>Room</th>
                <th>Check-In</th>
                <th>Check-Out</th>
                <th>Nights</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Total Amount</th>
                <th>Amount Paid</th>
                <th>Amount Due</th>
                <th>Add payment</th>
                <th>Order Food</th>
                <th>Pay Food</th>
                <th>Bill</th>
                <th>Actions</th>
                
                <th>View</th>
                <th>Edit</th>
                <th>Cancel</th>
              </tr>
            </thead>
            <tbody>
              {filteredBookings.map(booking => (
                <tr key={booking.booking_id}>
                  <td>#{booking.booking_id || 'N/A'}</td>
                  <td>
                    <div className="customer-info">
                      <div>{booking?.customer?.name || booking?.primary_guest?.name || 'N/A'}</div>
                      <small>{booking?.customer?.phone || booking?.primary_guest?.phone || 'N/A'}</small>
                      {booking?.additional_guests?.length > 0 && (
                        <small className="additional-guests">+{booking.additional_guests.length} more guests</small>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="room-info">
                      {booking?.rooms?.map((room, index) => (
                        <div key={`${booking.booking_id}-${room.room_id}-${index}`} className={index > 0 ? 'mt-2' : ''}>
                          <div>Room {room.room_number}</div>
                          <small>{room.room_type} (₹{room.price_per_night}/night)</small>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td>{booking.checkin_date ? format(new Date(booking.checkin_date), 'dd MMM yyyy') : 'N/A'}</td>
                  <td>{booking.checkout_date ? format(new Date(booking.checkout_date), 'dd MMM yyyy') : 'N/A'}</td>
                  <td>{booking.checkin_date && booking.checkout_date ? calculateNights(booking.checkin_date, booking.checkout_date) : 'N/A'}</td>
                  <td>
                    <span className={`status-badge ${getStatusColor(booking.status)}`}>
                      {booking.status}
                    </span>
                  </td>
                  <td>
                    <div className="payment-action">
                      <span className={`payment-status payment-${booking.payment_status?.toLowerCase()}`}>
                        {booking.payment_status === 'REFUND' ? 'Refund' : 
                         booking.payment_status === 'PAID' ? 'Paid' : 
                         booking.payment_status === 'PARTIAL' ? 'Partial' : 'Unpaid'}
                      </span>
                    </div>
                  </td>
                  <td>₹{booking.total_amount}</td>
                  <td>₹{booking.amount_paid || 0}</td>
                  {/* <td>₹{booking.amount_due
                   || (booking.total_amount - (booking.amount_paid || 0))}</td> */}

                   <td>₹{booking.amount_due}</td>

                  <td>
                    <button
                      onClick={() => handleOpenPaymentModal(booking)}
                      className="add-payment-btn"
                      disabled={booking.status?.toLowerCase() === 'cancelled' || booking.payment_status === 'PAID'}
                      title={
                        booking.status?.toLowerCase() === 'cancelled'
                          ? 'Cannot add payment to cancelled booking'
                          : booking.payment_status === 'PAID'
                          ? 'Booking is fully paid'
                          : 'Add payment'
                      }
                    >
                      Add Payment
                    </button>
                  </td>
                  <td data-test="order-food-column">
                    <button
                      onClick={() => handleOpenFoodModal(booking)}
                      className={bookingFoodOrders[booking.booking_id]?.exists ? "edit-food-btn" : "order-food-btn"}
                      disabled={!['checkin', 'checked-in', 'checked in'].includes(booking.status?.toLowerCase())}
                      title={
                        !['checkin', 'checked-in', 'checked in'].includes(booking.status?.toLowerCase())
                          ? `Food order only available for checked-in bookings (Current status: ${booking.status})`
                          : bookingFoodOrders[booking.booking_id]?.exists ? 'Edit Food Order' : 'Order Food'
                      }
                    >
                      <span>{bookingFoodOrders[booking.booking_id]?.exists ? '📝 Edit Food' : '🍽️ Order Food'}</span>
                    </button>
                  </td>
                  <td data-test="pay-food-column">
                    <button
                      onClick={() => handleOpenFoodPaymentModal(booking)}
                      className="pay-food-btn"
                      disabled={!['checkin', 'checked-in', 'checked in'].includes(booking.status?.toLowerCase()) || !bookingFoodOrders[booking.booking_id]?.exists || (bookingFoodOrders[booking.booking_id]?.amount_due || 0) === 0}
                      title={
                        !['checkin', 'checked-in', 'checked in'].includes(booking.status?.toLowerCase())
                          ? `Food payment only available for checked-in bookings (Current status: ${booking.status})`
                          : !bookingFoodOrders[booking.booking_id]?.exists
                          ? 'No food order exists for this booking'
                          : (bookingFoodOrders[booking.booking_id]?.amount_due || 0) === 0
                          ? 'No pending food payment dues'
                          : 'Add payment for food order'
                      }
                    >
                      💳 Pay Food
                    </button>
                  </td>
                  <td>
                    <button 
                      onClick={() => handleViewInvoice(booking.booking_id)}
                      disabled={booking.payment_status?.toUpperCase() !== 'PAID'}
                      className={`view-invoice-btn ${booking.payment_status?.toUpperCase() !== 'PAID' ? 'disabled' : ''}`}
                      title={booking.payment_status?.toUpperCase() !== 'PAID' ? 'Complete payment to view invoice' : 'View/Download Invoice'}
                    >
                      <RiEyeLine />
                      <span className="icon-text">Invoice</span>
                    </button>
                  </td>
                  <td className="actions-cell">
                 
                    {/* Check-in button for upcoming bookings */}
                    {booking.status?.toLowerCase() === 'upcoming' && (
                      <button 
                        onClick={() => handleCheckin(booking.booking_id)}
                        className="checkin-btn"
                        title="Check In Guest"
                      >
                        Check In
                      </button>
                    )}
                    {booking.status?.toLowerCase() === 'checked-in' && 
                     booking.payment_status?.toUpperCase() === 'PAID' && 
                     !bookingFoodOrders[booking.booking_id]?.has_pending_payment && (
                      <button 
                        onClick={() => handleCheckout(booking.booking_id)}
                        className="checkout-btn"
                        title="Checkout Guest"
                      >
                        Checkout
                      </button>
                    )}
                    {booking.status?.toLowerCase() === 'checked-in' && 
                     booking.payment_status?.toUpperCase() === 'PAID' && 
                     bookingFoodOrders[booking.booking_id]?.has_pending_payment && (
                      <span 
                        className="pending-payment-badge" 
                        title={`Clear food payment of ₹${bookingFoodOrders[booking.booking_id]?.amount_due?.toFixed(2) || 0} first`}
                        style={{
                          backgroundColor: '#FFF3CD',
                          color: '#856404',
                          padding: '6px 12px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: '600',
                          display: 'inline-block',
                          border: '1px solid #FFEAA7'
                        }}
                      >
                        Food Payment Due
                      </span>
                    )}
                    {booking.status?.toLowerCase() === 'checked-out' && (
                      <span className="checkout-complete">Completed</span>
                    )}
                     {booking.status?.toLowerCase() === 'cancelled' && (
                      <span className="cancelled-status">Cancelled</span>
                    )}
                    {/* {['upcoming', 'checked-in'].includes(booking.status?.toLowerCase()) && (
                      <button 
                        onClick={() => handleCancelBooking(booking.booking_id)}
                        className="cancel-btn"
                        title="Cancel Booking"
                      >
                        Cancel
                      </button>
                    )}
                    {booking.status?.toLowerCase() === 'cancelled' && (
                      <span className="cancelled-status">Cancelled</span>
                    )} */}
                  </td>
                       
                  <td className="view-cell">
                    <button
                      onClick={() => navigate(`/booking/view/${booking.booking_id}`)}
                      className="view-btn"
                      title="View Booking Details"
                    >
                      <RiEyeLine />
                      <span className="icon-text">View</span>
                    </button>
                   
                  </td>
                   <td className="edit-cell">
                          <button
                      onClick={() => navigate(`/edit-booking/${booking.booking_id}`)}
                      className="edit-btn"
                      title="Edit Booking"
                    >
                      <RiEdit2Line />
                      <span className="icon-text">Edit</span>
                    </button>
                  </td>
                  <td className='edit-cell'>
                     
                    {['upcoming', 'checked-in'].includes(booking.status?.toLowerCase()) && (
                      <button 
                        onClick={() => handleCancelBooking(booking)}
                        className="cancel-btn"
                        title="Cancel Booking"
                      >
                        Cancel

                      </button>
                    )}
                    {booking.status?.toLowerCase() === 'cancelled' && (
                      <span className="cancelled-status">
                        {booking.refund_amount ? (
                          <div>
                            <div>Refunded ₹{booking.refund_amount}</div>
                            {booking.refunded_at && (
                              <small className="text-gray-500">
                                {format(new Date(booking.refunded_at), 'dd MMM yyyy')}
                              </small>
                            )}
                          </div>
                        ) : 'Cancelled'}
                      </span>
                    )}

                  </td>
                 
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Payment Modal */}
      <Transition appear show={showPaymentModal} as={Fragment}>
        <Dialog 
          as="div" 
          className="relative z-10" 
          onClose={() => {
            setShowPaymentModal(false);
            setPaymentBooking(null);
          }}
        >
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black bg-opacity-25" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title
                    as="h3"
                    className="text-lg font-medium leading-6 text-gray-900 mb-4"
                  >
                    Add Payment for Booking #{paymentBooking?.booking_id}
                  </Dialog.Title>

                  {paymentBooking && (
                    <>
                      <div className="mb-4 bg-gray-50 p-4 rounded-lg">
                        <p className="mb-2">
                          <span className="font-medium">Customer:</span>{' '}
                          {paymentBooking.customer?.name || paymentBooking.primary_guest?.name}
                        </p>
                        <div className="text-sm text-gray-600">
                          <p className="flex justify-between py-1">
                            <span>Total Amount:</span>
                            <span>₹{paymentBooking.total_amount}</span>
                          </p>
                          <p className="flex justify-between py-1">
                            <span>Amount Paid:</span>
                            <span>₹{paymentBooking.amount_paid || 0}</span>
                          </p>
                          <p className="flex justify-between py-1 font-medium">
                            <span>Amount Due:</span>
                            <span>₹{paymentBooking.amount_due || (paymentBooking.total_amount - (paymentBooking.amount_paid || 0))}</span>
                          </p>
                          {newAmount && (
                            <p className="flex justify-between py-1 text-green-600 font-medium border-t mt-2 pt-2">
                              <span>New Amount Due:</span>
                              <span>₹{(paymentBooking.amount_due || (paymentBooking.total_amount - (paymentBooking.amount_paid || 0))) - parseFloat(newAmount || 0)}</span>
                            </p>
                          )}
                        </div>
                      </div>

                      <form onSubmit={handlePaymentSubmit} className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Payment Amount
                          </label>
                          <input
                            type="number"
                            value={newAmount}
                            onChange={(e) => setNewAmount(e.target.value)}
                            placeholder="Enter amount"
                            className="w-full p-2 border rounded-md"
                            max={paymentBooking.amount_due}
                            required
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Payment Mode
                          </label>
                          <select
                            value={paymentMode}
                            onChange={(e) => setPaymentMode(e.target.value)}
                            className="w-full p-2 border rounded-md"
                          >
                            <option value="Cash">Cash</option>
                            <option value="Card">Card</option>
                            <option value="UPI">UPI</option>
                            <option value="Bank Transfer">Bank Transfer</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>

                        <div className="flex justify-end gap-3 mt-6">
                          <button
                            type="button"
                            onClick={() => {
                              setShowPaymentModal(false);
                              setPaymentBooking(null);
                            }}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={isSubmitting || !newAmount || parseFloat(newAmount) <= 0}
                            className={`px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            {isSubmitting ? 'Processing...' : 'Add Payment'}
                          </button>
                        </div>
                      </form>
                    </>
                  )}
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* Refund Modal */}
      <RefundModal
        isOpen={showRefundModal}
        onClose={() => {
          setShowRefundModal(false);
          setSelectedBookingForRefund(null);
        }}
        booking={selectedBookingForRefund}
        onRefundComplete={async () => {
          await fetchBookings();
          setShowRefundModal(false);
          setSelectedBookingForRefund(null);
        }}
      />

      {/* Booking Detail Modal */}
      {showDetailModal && selectedBooking && (
        <div className="modal-overlay">
          <div className="booking-detail-modal">
            <div className="modal-header">
              <h2>Booking Details #{selectedBooking.booking_id}</h2>
              <button onClick={() => setShowDetailModal(false)}>&times;</button>
            </div>
            
            <div className="modal-content">
              <div className="detail-section">
                <h3>Customer Information</h3>
                <div className="detail-grid">
                  <div className="detail-item">
                    <span className="label">Name:</span>
                    <span>{selectedBooking.customer.name}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Phone:</span>
                    <span>{selectedBooking.customer.phone}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Email:</span>
                    <span>{selectedBooking.customer.email || 'N/A'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">ID Proof:</span>
                    <span>{selectedBooking.customer.id_proof || 'N/A'}</span>
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h3>Room Information</h3>
                <div className="detail-grid">
                  <div className="detail-item">
                    <span className="label">Room Number:</span>
                    <span>{selectedBooking.room.room_number}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Room Type:</span>
                    <span>{selectedBooking.room.room_type}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Price per Night:</span>
                    <span>₹{selectedBooking.room.price_per_night}</span>
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h3>Booking Information</h3>
                <div className="detail-grid">
                  <div className="detail-item">
                    <span className="label">Check-In:</span>
                    <span>{format(new Date(selectedBooking.checkin_date), 'dd MMM yyyy')}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Check-Out:</span>
                    <span>{format(new Date(selectedBooking.checkout_date), 'dd MMM yyyy')}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Nights:</span>
                    <span>{calculateNights(selectedBooking.checkin_date, selectedBooking.checkout_date)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Status:</span>
                    <span className={`status-badge ${getStatusColor(selectedBooking.status)}`}>
                      {selectedBooking.status}
                    </span>
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h3>Payment Information</h3>
                <div className="detail-grid">
                  <div className="detail-item">
                    <span className="label">Total Amount:</span>
                    <span>₹{selectedBooking.total_amount}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Paid Amount:</span>
                    <span>₹{selectedBooking.paid_amount}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Balance:</span>
                    <span>₹{selectedBooking.total_amount - selectedBooking.paid_amount}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Payment Status:</span>
                    <span className={`payment-status payment-${selectedBooking.payment_status.toLowerCase()}`}>
                      {selectedBooking.payment_status}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={() => navigate(`/bookings/${selectedBooking.booking_id}/invoice`)}>
                View Invoice
              </button>
              <button onClick={() => handleEditBooking(selectedBooking.booking_id)}>
                Edit Booking
              </button>
              <button onClick={() => setShowDetailModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Food Order Modal */}
      <FoodPaymentModal
        isOpen={showFoodPaymentModal}
        onClose={() => {
          setShowFoodPaymentModal(false);
          setFoodPaymentAmount('');
          setSelectedBookingForFoodPayment(null);
          setFoodOrderData(null);
        }}
        onSubmit={handleFoodPaymentSubmit}
        booking={selectedBookingForFoodPayment}
        foodOrder={foodOrderData}
        paymentAmount={foodPaymentAmount}
        setPaymentAmount={setFoodPaymentAmount}
        paymentMode={foodPaymentMode}
        setPaymentMode={setFoodPaymentMode}
        isSubmitting={isSubmitting}
      />

      {/* Print Format Modal */}
      <Transition appear show={showPrintFormatModal} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowPrintFormatModal(false)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black bg-opacity-25" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-lg bg-white p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="h3" className="text-lg font-medium leading-6 text-gray-900 mb-4">
                    Select Invoice Format
                  </Dialog.Title>

                  <div className="space-y-3">
                    <button
                      onClick={() => handlePrintFormatSelected('A4')}
                      className="w-full px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center justify-center gap-2 font-medium"
                    >
                      📄 A4 Format (PDF)
                    </button>

                    <button
                      onClick={() => handlePrintFormatSelected('thermal')}
                      className="w-full px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex items-center justify-center gap-2 font-medium"
                    >
                      🖨️ Thermal (80mm)
                    </button>

                    <button
                      onClick={() => setShowPrintFormatModal(false)}
                      className="w-full px-4 py-3 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400 transition-colors font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
};

export default BookingManagement;
