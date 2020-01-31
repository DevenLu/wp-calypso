/**
 * External dependencies
 */
import React, { useEffect, useState, useMemo } from 'react';
import PropTypes from 'prop-types';
import styled from '@emotion/styled';
import debugFactory from 'debug';

/**
 * Internal dependencies
 */
import joinClasses from '../lib/join-classes';
import { useLocalize, sprintf } from '../lib/localize';
import CheckoutStep from './checkout-step';
import CheckoutNextStepButton from './checkout-next-step-button';
import CheckoutSubmitButton from './checkout-submit-button';
import LoadingContent from './loading-content';
import { usePrimarySelect, usePrimaryDispatch, useRegisterPrimaryStore } from '../lib/registry';
import { usePaymentMethod } from '../lib/payment-methods';
import CheckoutErrorBoundary from './checkout-error-boundary';
import {
	useSetStepComplete,
	useActiveStep,
	ActiveStepProvider,
	RenderedStepProvider,
} from '../lib/active-step';
import {
	getDefaultOrderSummaryStep,
	getDefaultPaymentMethodStep,
	getDefaultOrderReviewStep,
} from './default-steps';
import { validateSteps } from '../lib/validation';
import { useEvents } from './checkout-provider';
import { useFormStatus } from '../lib/form-status';
import useConstructor from '../lib/use-constructor';

const debug = debugFactory( 'composite-checkout:checkout' );

function useRegisterCheckoutStore() {
	const onEvent = useEvents();
	useRegisterPrimaryStore( {
		reducer( state = { stepNumber: 1 }, action ) {
			switch ( action.type ) {
				case 'STEP_NUMBER_SET':
					return { ...state, stepNumber: action.payload };
			}
			return state;
		},
		actions: {
			*changeStep( payload ) {
				yield { type: 'STEP_NUMBER_CHANGE_EVENT', payload };
				return { type: 'STEP_NUMBER_SET', payload };
			},
		},
		controls: {
			STEP_NUMBER_CHANGE_EVENT( action ) {
				onEvent( action );
				saveStepNumberToUrl( action.payload );
			},
		},
		selectors: {
			getStepNumber( state ) {
				return state.stepNumber;
			},
		},
	} );
}

export default function Checkout( { steps: stepProps, className } ) {
	useRegisterCheckoutStore();
	const { formStatus } = useFormStatus();

	// stepNumber is the displayed number of the active step, not its index
	const stepNumber = usePrimarySelect( select => select().getStepNumber() );
	debug( 'current step number is', stepNumber );
	const { changeStep } = usePrimaryDispatch();
	const steps = useDefaultStepsIfNeeded( stepProps );
	validateSteps( steps );

	// Assign step numbers to all steps with numbers
	const annotatedSteps = getAnnotatedSteps( steps );

	const activeStep = annotatedSteps.find( step => step.stepNumber === stepNumber );
	if ( ! activeStep ) {
		throw new Error( 'The active step was lost' );
	}

	const [ stepCompleteStatus, setStepCompleteStatus ] = useTrackCompleteSteps();

	// Change the step if the url changes
	useChangeStepNumberForUrl( annotatedSteps, stepCompleteStatus );

	const nextStep = annotatedSteps.find( ( step, index ) => {
		return index > activeStep.stepIndex && step.hasStepNumber;
	} );
	const isThereAnotherNumberedStep = !! nextStep && nextStep.hasStepNumber;

	if ( formStatus === 'loading' ) {
		return (
			<Container className={ joinClasses( [ className, 'composite-checkout' ] ) }>
				<MainContent
					className={ joinClasses( [ className, 'checkout__content' ] ) }
					isLastStepActive={ isThereAnotherNumberedStep }
				>
					<LoadingContent />
				</MainContent>
			</Container>
		);
	}

	return (
		<Container className={ joinClasses( [ className, 'composite-checkout' ] ) }>
			<MainContent
				className={ joinClasses( [ className, 'checkout__content' ] ) }
				isLastStepActive={ isThereAnotherNumberedStep }
			>
				<ActiveStepProvider
					step={ activeStep }
					steps={ annotatedSteps }
					stepCompleteStatus={ stepCompleteStatus }
					setStepCompleteStatus={ setStepCompleteStatus }
				>
					{ annotatedSteps.map( step => (
						<CheckoutStepContainer
							{ ...step }
							key={ step.id }
							isComplete={ stepCompleteStatus[ step.id ] ?? false }
							stepNumber={ step.stepNumber || null }
							shouldShowNextButton={
								step.hasStepNumber && step.id === activeStep.id && isThereAnotherNumberedStep
							}
							goToNextStep={ () => changeStep( nextStep.stepNumber ) }
							onEdit={
								formStatus === 'ready' &&
								step.id !== activeStep.id &&
								step.hasStepNumber &&
								step.isEditableCallback &&
								step.isEditableCallback()
									? () => changeStep( step.stepNumber )
									: null
							}
						/>
					) ) }
				</ActiveStepProvider>

				<SubmitButtonWrapper isThereAnotherNumberedStep={ isThereAnotherNumberedStep } />
			</MainContent>
		</Container>
	);
}

Checkout.propTypes = {
	className: PropTypes.string,
	steps: PropTypes.array,
};

function SubmitButtonWrapper( { isThereAnotherNumberedStep } ) {
	const localize = useLocalize();
	const { formStatus } = useFormStatus();

	return (
		<SubmitButtonWrapperUI isLastStepActive={ ! isThereAnotherNumberedStep }>
			<CheckoutErrorBoundary
				errorMessage={ localize( 'There was a problem with the submit button.' ) }
			>
				<CheckoutSubmitButton disabled={ isThereAnotherNumberedStep || formStatus !== 'ready' } />
			</CheckoutErrorBoundary>
		</SubmitButtonWrapperUI>
	);
}

function CheckoutStepContainer( {
	id,
	titleContent,
	className,
	activeStepContent,
	incompleteStepContent,
	completeStepContent,
	stepNumber,
	shouldShowNextButton,
	goToNextStep,
	getNextStepButtonAriaLabel,
	onEdit,
	getEditButtonAriaLabel,
	isComplete,
} ) {
	const localize = useLocalize();
	const activeStep = useActiveStep();
	const isActive = activeStep.id === id;
	const setStepComplete = useSetStepComplete();
	const { formStatus, setFormReady, setFormValidating } = useFormStatus();
	const activePaymentMethod = usePaymentMethod();

	const onClick = () => {
		const evaluateContinue = result => {
			setFormReady();
			if ( result === true ) {
				debug( 'continuing to next step; step is complete' );
				// cache isCompleteResult for other functions
				setStepComplete( id, true );
				goToNextStep();
				return;
			}
			// cache isCompleteResult for other functions
			setStepComplete( id, false );
			debug( 'not continuing to next step; step is not complete' );
		};

		const isCompleteResult = activeStep.isCompleteCallback?.( { activePaymentMethod } ) ?? true;
		if ( isCompleteResult.then ) {
			debug( 'maybe continuing to next step; step is evaluating a Promise' );
			setFormValidating();
			isCompleteResult.then( evaluateContinue );
			return;
		}
		evaluateContinue( isCompleteResult );
	};

	const shouldShowStepCompleteIcon = ! stepNumber || activeStep.stepNumber > stepNumber;

	return (
		<CheckoutErrorBoundary
			errorMessage={ sprintf( localize( 'There was a problem with the step "%s".' ), id ) }
		>
			<RenderedStepProvider stepId={ id }>
				<CheckoutStep
					id={ id }
					className={ className }
					isActive={ isActive }
					isComplete={ shouldShowStepCompleteIcon }
					stepNumber={ stepNumber }
					title={ titleContent || '' }
					onEdit={ onEdit }
					editButtonAriaLabel={ getEditButtonAriaLabel && getEditButtonAriaLabel() }
					stepContent={
						<React.Fragment>
							{ activeStepContent }
							{ shouldShowNextButton && (
								<CheckoutNextStepButton
									value={ localize( 'Continue' ) }
									onClick={ onClick }
									ariaLabel={ getNextStepButtonAriaLabel && getNextStepButtonAriaLabel() }
									disabled={ formStatus !== 'ready' }
									buttonState={ formStatus !== 'ready' ? 'disabled' : 'primary' }
								/>
							) }
						</React.Fragment>
					}
					stepSummary={ isComplete ? completeStepContent : incompleteStepContent }
				/>
			</RenderedStepProvider>
		</CheckoutErrorBoundary>
	);
}

const Container = styled.div`
	*:focus {
		outline: ${props => props.theme.colors.outline} solid 2px;
	}
`;

const MainContent = styled.div`
	background: ${props => props.theme.colors.surface};
	width: 100%;
	box-sizing: border-box;
	margin-bottom: ${props => ( props.isLastStepActive ? '89px' : 0 )};

	@media ( ${props => props.theme.breakpoints.tabletUp} ) {
		border: 1px solid ${props => props.theme.colors.borderColorLight};
		margin: 32px auto;
		box-sizing: border-box;
		max-width: 556px;
	}
`;

const SubmitButtonWrapperUI = styled.div`
	background: ${props => props.theme.colors.background};
	padding: 24px;
	position: ${props => ( props.isLastStepActive ? 'fixed' : 'relative' )};
	bottom: 0;
	left: 0;
	box-sizing: border-box;
	width: 100%;
	z-index: 10;
	border-top-width: ${props => ( props.isLastStepActive ? '1px' : '0' )};
	border-top-style: solid;
	border-top-color: ${props => props.theme.colors.borderColorLight};

	@media ( ${props => props.theme.breakpoints.tabletUp} ) {
		position: relative;
		border: 0;
	}
`;

function useDefaultStepsIfNeeded( steps ) {
	const localize = useLocalize();
	return useMemo( () => {
		if ( steps ) {
			return steps;
		}
		return makeDefaultSteps( localize );
	}, [ steps, localize ] );
}

function makeDefaultSteps( localize ) {
	return [
		getDefaultOrderSummaryStep(),
		{
			...getDefaultPaymentMethodStep(),
			getEditButtonAriaLabel: () => localize( 'Edit the payment method' ),
			getNextStepButtonAriaLabel: () => localize( 'Continue with the selected payment method' ),
		},
		getDefaultOrderReviewStep(),
	];
}

function getStepNumberFromUrl() {
	const hashValue = window.location?.hash;
	if ( hashValue?.startsWith?.( '#step' ) ) {
		const parts = hashValue.split( '#step' );
		const stepNumber = parts.length > 1 ? parts[ 1 ] : 1;
		return parseInt( stepNumber, 10 );
	}
	return 1;
}

function saveStepNumberToUrl( stepNumber ) {
	if ( ! window.history?.pushState ) {
		return;
	}
	const newHash = stepNumber > 1 ? `#step${ stepNumber }` : '';
	if ( window.location.hash === newHash ) {
		return;
	}
	const newUrl = window.location.hash
		? window.location.href.replace( window.location.hash, newHash )
		: window.location.href + newHash;
	debug( 'updating url to', newUrl );
	window.history.pushState( null, null, newUrl );
}

function areAllPreviousStepsComplete( steps, stepNumber, stepCompleteStatus ) {
	return steps.reduce( ( allComplete, step ) => {
		if ( step.stepNumber && step.stepNumber < stepNumber ) {
			if ( allComplete === false ) {
				return false;
			}
			return stepCompleteStatus[ step.id ] ?? false;
		}
		return allComplete;
	}, false );
}

function useChangeStepNumberForUrl( steps, stepCompleteStatus ) {
	const { changeStep } = usePrimaryDispatch();
	useConstructor( () => {
		const newStepNumber = getStepNumberFromUrl();
		if ( areAllPreviousStepsComplete( steps, newStepNumber, stepCompleteStatus ) ) {
			debug( 'changing initial step to', newStepNumber );
			changeStep( newStepNumber );
			return;
		}
		changeStep( 1 );
	} );
	useEffect( () => {
		let isSubscribed = true;
		window.addEventListener?.( 'hashchange', () => {
			const newStepNumber = getStepNumberFromUrl();
			debug( 'step number in url changed to', newStepNumber );
			isSubscribed && changeStep( newStepNumber );
		} );
		return () => ( isSubscribed = false );
	}, [ changeStep ] );
}

function getAnnotatedSteps( steps ) {
	// Assign step numbers to all steps with numbers
	let numberedStepNumber = 0;
	const annotatedSteps = steps.map( ( step, index ) => {
		numberedStepNumber = step.hasStepNumber ? numberedStepNumber + 1 : numberedStepNumber;
		return {
			...step,
			stepNumber: step.hasStepNumber ? numberedStepNumber : null,
			stepIndex: index,
		};
	} );
	if ( annotatedSteps.length < 1 ) {
		throw new Error( 'No steps found' );
	}
	return annotatedSteps;
}

function useTrackCompleteSteps() {
	const [ stepCompleteStatus, setStepCompleteStatus ] = useState( {} );
	return [ stepCompleteStatus, setStepCompleteStatus ];
}
